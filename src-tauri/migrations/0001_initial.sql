CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (version) VALUES (1);

CREATE TABLE games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    overlay_display_mode TEXT NOT NULL DEFAULT 'title'
        CHECK (overlay_display_mode IN ('title', 'full'))
);

CREATE UNIQUE INDEX games_sort_order_uq ON games (sort_order);

CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX groups_game_sort_order_uq ON groups (game_id, sort_order);

CREATE TABLE phrases (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_template TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    favorite_order INTEGER CHECK (favorite_order IS NULL OR favorite_order >= 0),
    hotkey TEXT,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX phrases_group_sort_order_uq ON phrases (group_id, sort_order);

CREATE TABLE variable_definitions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX variable_definitions_game_name_uq
    ON variable_definitions (game_id, normalized_name);
CREATE UNIQUE INDEX variable_definitions_game_sort_order_uq
    ON variable_definitions (game_id, sort_order);

CREATE TABLE variable_presets (
    id TEXT PRIMARY KEY,
    variable_definition_id TEXT NOT NULL,
    value TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    FOREIGN KEY (variable_definition_id)
        REFERENCES variable_definitions (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX variable_presets_definition_sort_order_uq
    ON variable_presets (variable_definition_id, sort_order);

CREATE TABLE phrase_variable_refs (
    phrase_id TEXT NOT NULL,
    variable_definition_id TEXT NOT NULL,
    token_order INTEGER NOT NULL CHECK (token_order >= 0),
    PRIMARY KEY (phrase_id, token_order),
    FOREIGN KEY (phrase_id) REFERENCES phrases (id) ON DELETE RESTRICT,
    FOREIGN KEY (variable_definition_id)
        REFERENCES variable_definitions (id) ON DELETE RESTRICT
);

CREATE INDEX phrase_variable_refs_definition_idx
    ON phrase_variable_refs (variable_definition_id);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
