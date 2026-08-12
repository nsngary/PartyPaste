use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TemplateToken {
    Text { value: String },
    Variable { name: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateIssueCode {
    UnbalancedOpenBrace,
    UnbalancedCloseBrace,
    EmptyName,
    NestedBrace,
    ControlCharacter,
    MissingValue,
    EmptyValue,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateIssue {
    pub code: TemplateIssueCode,
    pub offset: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateScanResult {
    pub tokens: Vec<TemplateToken>,
    pub issues: Vec<TemplateIssue>,
}

pub struct TemplateService;

impl TemplateService {
    pub fn scan(source: &str) -> TemplateScanResult {
        let characters = source.chars().collect::<Vec<_>>();
        let mut tokens = Vec::new();
        let mut issues = Vec::new();
        let mut text = String::new();
        let mut index = 0;

        while index < characters.len() {
            let character = characters[index];
            let next = characters.get(index + 1).copied();

            if character == '{' && next == Some('{') {
                text.push('{');
                index += 2;
                continue;
            }
            if character == '}' && next == Some('}') {
                text.push('}');
                index += 2;
                continue;
            }
            if character == '}' {
                issues.push(TemplateIssue {
                    code: TemplateIssueCode::UnbalancedCloseBrace,
                    offset: index,
                    name: None,
                });
                index += 1;
                continue;
            }
            if character != '{' {
                text.push(character);
                index += 1;
                continue;
            }

            flush_text(&mut tokens, &mut text);
            let opening_offset = index;
            let mut cursor = index + 1;
            let mut depth = 1usize;
            let mut nested = false;
            let mut name = String::new();

            while cursor < characters.len() && depth > 0 {
                match characters[cursor] {
                    '{' => {
                        nested = true;
                        depth += 1;
                    }
                    '}' => depth -= 1,
                    value if depth == 1 => name.push(value),
                    _ => {}
                }
                cursor += 1;
            }

            let issue = if depth > 0 {
                Some(TemplateIssueCode::UnbalancedOpenBrace)
            } else if nested {
                Some(TemplateIssueCode::NestedBrace)
            } else if name.is_empty() {
                Some(TemplateIssueCode::EmptyName)
            } else if name.chars().any(char::is_control) {
                Some(TemplateIssueCode::ControlCharacter)
            } else {
                None
            };

            if let Some(code) = issue {
                issues.push(TemplateIssue {
                    code,
                    offset: opening_offset,
                    name: None,
                });
            } else {
                tokens.push(TemplateToken::Variable { name });
            }
            index = cursor;
        }

        flush_text(&mut tokens, &mut text);
        TemplateScanResult { tokens, issues }
    }

    pub fn render(tokens: &[TemplateToken]) -> String {
        let mut source = String::new();
        for token in tokens {
            match token {
                TemplateToken::Text { value } => {
                    for character in value.chars() {
                        match character {
                            '{' => source.push_str("{{"),
                            '}' => source.push_str("}}"),
                            _ => source.push(character),
                        }
                    }
                }
                TemplateToken::Variable { name } => {
                    source.push('{');
                    source.push_str(name);
                    source.push('}');
                }
            }
        }
        source
    }

    pub fn resolve(
        tokens: &[TemplateToken],
        values: &HashMap<String, String>,
    ) -> Result<String, Vec<TemplateIssue>> {
        let mut resolved = String::new();
        let mut issues = Vec::new();
        let mut reported_names = HashSet::new();

        for (offset, token) in tokens.iter().enumerate() {
            match token {
                TemplateToken::Text { value } => resolved.push_str(value),
                TemplateToken::Variable { name } => match values.get(name) {
                    None if reported_names.insert(name) => issues.push(TemplateIssue {
                        code: TemplateIssueCode::MissingValue,
                        offset,
                        name: Some(name.clone()),
                    }),
                    Some(value) if value.trim().is_empty() && reported_names.insert(name) => {
                        issues.push(TemplateIssue {
                            code: TemplateIssueCode::EmptyValue,
                            offset,
                            name: Some(name.clone()),
                        });
                    }
                    Some(value) if !value.trim().is_empty() => resolved.push_str(value),
                    _ => {}
                },
            }
        }

        if issues.is_empty() {
            Ok(resolved)
        } else {
            Err(issues)
        }
    }
}

fn flush_text(tokens: &mut Vec<TemplateToken>, text: &mut String) {
    if !text.is_empty() {
        tokens.push(TemplateToken::Text {
            value: std::mem::take(text),
        });
    }
}
