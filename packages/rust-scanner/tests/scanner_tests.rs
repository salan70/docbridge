use docbridge_rust_scanner::{is_valid_link_target, scan_request_json};
use serde_json::{json, Value};

fn scan(content: &str, visibility: Option<Vec<&str>>) -> Value {
    let request = json!({
        "schemaVersion": 1,
        "requestId": "test-req",
        "language": "rust",
        "projectRoot": "/tmp/project",
        "files": [{
            "filePath": "src/lib.rs",
            "content": content
        }],
        "options": {
            "visibility": visibility
        }
    });
    let response = scan_request_json(&request.to_string()).expect("scan succeeds");
    serde_json::from_str(&response).expect("response is JSON")
}

fn endpoints(response: &Value) -> Vec<String> {
    response["files"][0]["symbols"]
        .as_array()
        .expect("symbols")
        .iter()
        .map(|symbol| symbol["endpoint"].as_str().unwrap().to_string())
        .collect()
}

fn undocumented(response: &Value) -> Vec<String> {
    response["files"][0]["undocumentedSymbols"]
        .as_array()
        .expect("undocumentedSymbols")
        .iter()
        .map(|symbol| symbol["endpoint"].as_str().unwrap().to_string())
        .collect()
}

fn link_targets(response: &Value) -> Vec<String> {
    response["files"][0]["links"]
        .as_array()
        .expect("links")
        .iter()
        .map(|link| link["target"].as_str().unwrap().to_string())
        .collect()
}

fn diagnostic_codes(response: &Value) -> Vec<String> {
    response["files"][0]["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .map(|diag| diag["code"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn extracts_doc_on_pub_struct_and_inherent_method() {
    let source = r#"
/// @doc docs/auth.md#auth-service
pub struct AuthService;

impl AuthService {
    /// @doc docs/auth.md#login-flow
    pub fn login(&self, email: &str, password: &str) {}
}
"#;
    let response = scan(source, None);
    assert_eq!(
        endpoints(&response),
        vec![
            "src/lib.rs#AuthService".to_string(),
            "src/lib.rs#AuthService::login".to_string(),
        ]
    );
    assert_eq!(
        link_targets(&response),
        vec![
            "docs/auth.md#auth-service".to_string(),
            "docs/auth.md#login-flow".to_string(),
        ]
    );
}

#[test]
fn extracts_free_fn_enum_and_nested_mod() {
    let source = r#"
/// @doc docs/rules.md#normalize
pub fn normalize(input: &str) -> String { input.to_string() }

/// @doc docs/rules.md#skip-reason
pub enum SkipReason { Hidden, Ignored }

pub mod domain {
    //! @doc docs/architecture.md#domain
    pub mod typing {
        /// @doc docs/architecture.md#typing-engine
        pub struct TypingEngine;
    }
}
"#;
    let response = scan(source, None);
    let mut found = endpoints(&response);
    found.sort();
    assert!(found.contains(&"src/lib.rs#normalize".to_string()));
    assert!(found.contains(&"src/lib.rs#SkipReason".to_string()));
    assert!(found.contains(&"src/lib.rs#domain".to_string()));
    assert!(found.contains(&"src/lib.rs#domain::typing::TypingEngine".to_string()));
}

#[test]
fn defaults_to_pub_only_and_can_include_private() {
    let source = r#"
/// @doc docs/a.md#public-fn
pub fn public_fn() {}

/// @doc docs/a.md#private-fn
fn private_fn() {}
"#;
    let pub_only = scan(source, None);
    assert_eq!(
        endpoints(&pub_only),
        vec!["src/lib.rs#public_fn".to_string()]
    );

    let with_private = scan(source, Some(vec!["pub", "private"]));
    let mut found = endpoints(&with_private);
    found.sort();
    assert_eq!(
        found,
        vec![
            "src/lib.rs#private_fn".to_string(),
            "src/lib.rs#public_fn".to_string(),
        ]
    );
}

#[test]
fn lists_visible_undocumented_symbols() {
    let source = r#"
pub struct AuthService;

impl AuthService {
    pub fn login(&self) {}
}
"#;
    let response = scan(source, None);
    let mut found = undocumented(&response);
    found.sort();
    assert_eq!(
        found,
        vec![
            "src/lib.rs#AuthService".to_string(),
            "src/lib.rs#AuthService::login".to_string(),
        ]
    );
}

#[test]
fn reports_parse_error_for_invalid_syntax() {
    let response = scan("pub fn broken(", None);
    assert_eq!(
        diagnostic_codes(&response),
        vec!["code_parse_error".to_string()]
    );
}

#[test]
fn reports_unsupported_trait_impl_method_with_doc() {
    let source = r#"
pub struct AuthService;

pub trait Login {
    fn login(&self);
}

impl Login for AuthService {
    /// @doc docs/auth.md#login-flow
    fn login(&self) {}
}
"#;
    let response = scan(source, None);
    assert!(diagnostic_codes(&response).contains(&"unsupported_declaration".to_string()));
    assert!(endpoints(&response).is_empty());
}

#[test]
fn reports_invalid_link_target() {
    let source = r#"
/// @doc ./docs/auth.md#login
pub fn login() {}
"#;
    let response = scan(source, None);
    assert!(diagnostic_codes(&response).contains(&"invalid_link_target".to_string()));
}

#[test]
fn validates_link_targets() {
    assert!(is_valid_link_target("docs/auth.md#login", "src/lib.rs"));
    assert!(!is_valid_link_target("./docs/auth.md#login", "src/lib.rs"));
    assert!(!is_valid_link_target("src/lib.rs#login", "src/lib.rs"));
    assert!(!is_valid_link_target("docs/auth.md", "src/lib.rs"));
}

#[test]
fn converts_name_locations_to_one_based_utf16_columns() {
    let source = "/// @doc docs/a.md#x\npub struct Café;\n";
    let response = scan(source, None);
    let symbol = &response["files"][0]["symbols"][0];
    assert_eq!(symbol["location"]["line"], 2);
    // `pub struct ` is 11 UTF-16 code units before `Café` (1-based => column 12).
    assert_eq!(symbol["location"]["column"], 12);
    assert_eq!(symbol["nameRange"]["start"]["column"], 12);
}
