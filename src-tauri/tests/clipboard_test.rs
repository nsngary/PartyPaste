use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use partypaste_lib::commands::clipboard::command_error_for_copy;
use partypaste_lib::db::Repository;
use partypaste_lib::db::models::{GameRecord, GroupRecord, OverlayDisplayMode, PhraseRecord};
use partypaste_lib::services::clipboard::{
    ClipboardError, ClipboardPort, ClipboardService, ClipboardServiceError, RetryDelay,
    SessionClock,
};
use partypaste_lib::services::session::SessionStore;

#[derive(Clone, Default)]
struct FakeClipboard {
    state: Arc<Mutex<FakeClipboardState>>,
}

#[derive(Default)]
struct FakeClipboardState {
    outcomes: VecDeque<Result<(), ClipboardError>>,
    writes: Vec<String>,
}

impl FakeClipboard {
    fn with_outcomes(outcomes: impl IntoIterator<Item = Result<(), ClipboardError>>) -> Self {
        Self {
            state: Arc::new(Mutex::new(FakeClipboardState {
                outcomes: outcomes.into_iter().collect(),
                writes: Vec::new(),
            })),
        }
    }

    fn writes(&self) -> Vec<String> {
        self.state.lock().unwrap().writes.clone()
    }
}

impl ClipboardPort for FakeClipboard {
    fn write_text(&self, text: &str) -> Result<(), ClipboardError> {
        let mut state = self.state.lock().unwrap();
        state.writes.push(text.to_owned());
        state.outcomes.pop_front().unwrap_or(Ok(()))
    }
}

#[derive(Clone, Default)]
struct RecordingDelay(Arc<Mutex<Vec<Duration>>>);

impl RecordingDelay {
    fn waits(&self) -> Vec<Duration> {
        self.0.lock().unwrap().clone()
    }
}

impl RetryDelay for RecordingDelay {
    fn wait(&self, duration: Duration) {
        self.0.lock().unwrap().push(duration);
    }
}

#[derive(Clone)]
struct IncrementingClock(Arc<AtomicU64>);

impl IncrementingClock {
    fn new(first: u64) -> Self {
        Self(Arc::new(AtomicU64::new(first)))
    }
}

impl SessionClock for IncrementingClock {
    fn now_millis(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}

fn seeded_repository(phrases: &[(&str, &str, &str)]) -> Repository {
    let mut repository = Repository::in_memory().unwrap();
    repository
        .transaction(|tx| {
            tx.insert_game(&GameRecord {
                id: "game".into(),
                name: "Game".into(),
                sort_order: 0,
                overlay_display_mode: OverlayDisplayMode::Title,
            })?;
            tx.insert_group(&GroupRecord {
                id: "group".into(),
                game_id: "game".into(),
                name: "Group".into(),
                collapsed: false,
                sort_order: 0,
            })?;
            for (sort_order, (id, title, body_template)) in phrases.iter().enumerate() {
                tx.insert_phrase(&PhraseRecord {
                    id: (*id).into(),
                    group_id: "group".into(),
                    title: (*title).into(),
                    body_template: (*body_template).into(),
                    favorite: false,
                    favorite_order: None,
                    hotkey: None,
                    sort_order: sort_order as i64,
                })?;
            }
            Ok(())
        })
        .unwrap();
    repository
}

fn service(
    repository: Repository,
    clipboard: FakeClipboard,
    delay: RecordingDelay,
    clock: IncrementingClock,
) -> ClipboardService {
    ClipboardService::with_runtime(repository, clipboard, delay, clock)
}

#[test]
fn clipboard_copies_plain_unicode_and_adds_the_success_to_recent_history() {
    let clipboard = FakeClipboard::default();
    let mut service = service(
        seeded_repository(&[("plain", "問候", "晚安，冒險者 🌙")]),
        clipboard.clone(),
        RecordingDelay::default(),
        IncrementingClock::new(1_000),
    );

    let copied = service.copy_phrase("plain", &HashMap::new()).unwrap();

    assert_eq!(clipboard.writes(), ["晚安，冒險者 🌙"]);
    assert_eq!(copied.phrase_id, "plain");
    assert_eq!(copied.title, "問候");
    assert_eq!(copied.resolved_at, 1_000);
    assert_eq!(copied.resolved_text, "晚安，冒險者 🌙");
    assert_eq!(service.get_recent_copies(), [copied]);
}

#[test]
fn clipboard_resolves_templates_with_task_four_authoritative_behavior() {
    let clipboard = FakeClipboard::default();
    let mut service = service(
        seeded_repository(&[("template", "組隊", "需要 {人數} 位，{{集合}} 時間 {時間}")]),
        clipboard.clone(),
        RecordingDelay::default(),
        IncrementingClock::new(2_000),
    );
    let values = HashMap::from([
        ("人數".to_owned(), "2".to_owned()),
        ("時間".to_owned(), "20:30".to_owned()),
    ]);

    let copied = service.copy_phrase("template", &values).unwrap();

    assert_eq!(copied.resolved_text, "需要 2 位，{集合} 時間 20:30");
    assert_eq!(clipboard.writes(), ["需要 2 位，{集合} 時間 20:30"]);
}

#[test]
fn clipboard_missing_or_empty_required_values_never_write_or_enter_history() {
    let clipboard = FakeClipboard::default();
    let mut service = service(
        seeded_repository(&[("template", "Secret title", "Secret {value}")]),
        clipboard.clone(),
        RecordingDelay::default(),
        IncrementingClock::new(3_000),
    );

    for values in [
        HashMap::new(),
        HashMap::from([("value".to_owned(), "  ".to_owned())]),
    ] {
        assert!(matches!(
            service.copy_phrase("template", &values),
            Err(ClipboardServiceError::InvalidTemplate)
        ));
    }

    assert!(clipboard.writes().is_empty());
    assert!(service.get_recent_copies().is_empty());
}

#[test]
fn clipboard_retries_twice_without_real_sleep_then_succeeds() {
    let clipboard = FakeClipboard::with_outcomes([
        Err(ClipboardError::Unavailable),
        Err(ClipboardError::Unavailable),
        Ok(()),
    ]);
    let delay = RecordingDelay::default();
    let mut service = service(
        seeded_repository(&[("plain", "Plain", "ready")]),
        clipboard.clone(),
        delay.clone(),
        IncrementingClock::new(4_000),
    );

    service.copy_phrase("plain", &HashMap::new()).unwrap();

    assert_eq!(clipboard.writes(), ["ready", "ready", "ready"]);
    assert_eq!(
        delay.waits(),
        [Duration::from_millis(50), Duration::from_millis(100)]
    );
    assert_eq!(service.get_recent_copies().len(), 1);
}

#[test]
fn clipboard_final_failure_is_sanitized_and_does_not_enter_history() {
    let secret = "private phrase contents";
    let clipboard = FakeClipboard::with_outcomes([
        Err(ClipboardError::Unavailable),
        Err(ClipboardError::Unavailable),
        Err(ClipboardError::Unavailable),
        Ok(()),
    ]);
    let delay = RecordingDelay::default();
    let mut service = service(
        seeded_repository(&[("private-id", "private title", secret)]),
        clipboard.clone(),
        delay.clone(),
        IncrementingClock::new(5_000),
    );

    let error = service
        .copy_phrase("private-id", &HashMap::new())
        .unwrap_err();
    assert!(matches!(error, ClipboardServiceError::ClipboardBusy));
    assert_eq!(clipboard.writes().len(), 3);
    assert_eq!(
        delay.waits(),
        [Duration::from_millis(50), Duration::from_millis(100)]
    );
    assert!(service.get_recent_copies().is_empty());

    let serialized = serde_json::to_string(&command_error_for_copy(error)).unwrap();
    assert_eq!(
        serialized,
        r#"{"code":"clipboard_busy","messageKey":"errors.clipboardBusy"}"#
    );
    assert!(!serialized.contains(secret));
    assert!(!serialized.contains("private title"));
    assert!(!serialized.contains("private-id"));
}

#[test]
fn clipboard_recent_history_is_newest_first_and_bounded_to_thirty() {
    let phrases = (0..31)
        .map(|index| {
            let id = format!("phrase-{index}");
            let title = format!("Title {index}");
            let body = format!("Body {index}");
            (id, title, body)
        })
        .collect::<Vec<_>>();
    let borrowed = phrases
        .iter()
        .map(|(id, title, body)| (id.as_str(), title.as_str(), body.as_str()))
        .collect::<Vec<_>>();
    let mut service = service(
        seeded_repository(&borrowed),
        FakeClipboard::default(),
        RecordingDelay::default(),
        IncrementingClock::new(6_000),
    );

    for (id, _, _) in &phrases {
        service.copy_phrase(id, &HashMap::new()).unwrap();
    }

    let recent = service.get_recent_copies();
    assert_eq!(recent.len(), 30);
    assert_eq!(recent.first().unwrap().phrase_id, "phrase-30");
    assert_eq!(recent.first().unwrap().resolved_at, 6_030);
    assert_eq!(recent.last().unwrap().phrase_id, "phrase-1");
    assert!(recent.iter().all(|copy| copy.phrase_id != "phrase-0"));
}

#[test]
fn clipboard_new_session_store_is_empty_and_library_snapshot_has_no_recent_data() {
    assert!(SessionStore::new().recent_copies().is_empty());

    let repository = seeded_repository(&[("plain", "Title", "Body")]);
    let serialized = serde_json::to_value(repository.snapshot().unwrap()).unwrap();
    assert_eq!(
        serialized.as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "games",
            "groups",
            "phraseVariableRefs",
            "phrases",
            "settings",
            "variableDefinitions",
            "variablePresets",
        ]
    );
    assert!(serialized.get("recentCopies").is_none());
    assert!(serialized.get("recent_copies").is_none());
}
