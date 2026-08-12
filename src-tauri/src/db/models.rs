use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayDisplayMode {
    Title,
    Full,
}

impl OverlayDisplayMode {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Full => "full",
        }
    }

    pub(super) fn from_database(value: &str) -> Option<Self> {
        match value {
            "title" => Some(Self::Title),
            "full" => Some(Self::Full),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRecord {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub overlay_display_mode: OverlayDisplayMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRecord {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub collapsed: bool,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseRecord {
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub body_template: String,
    pub favorite: bool,
    pub favorite_order: Option<i64>,
    pub hotkey: Option<String>,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableDefinitionRecord {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub normalized_name: String,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariablePresetRecord {
    pub id: String,
    pub variable_definition_id: String,
    pub value: String,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseVariableRefRecord {
    pub phrase_id: String,
    pub variable_definition_id: String,
    pub token_order: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRecord {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub games: Vec<GameRecord>,
    pub groups: Vec<GroupRecord>,
    pub phrases: Vec<PhraseRecord>,
    pub variable_definitions: Vec<VariableDefinitionRecord>,
    pub variable_presets: Vec<VariablePresetRecord>,
    pub phrase_variable_refs: Vec<PhraseVariableRefRecord>,
    pub settings: Vec<SettingRecord>,
}
