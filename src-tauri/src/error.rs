use serde::Serialize;

/// Every fallible backend path funnels into this type so the frontend always
/// receives a readable string instead of a panic or an opaque IPC failure.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("registry: {0}")]
    Registry(String),
    #[error("access denied: {0}")]
    AccessDenied(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("command failed: {0}")]
    Command(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn registry(context: &str, err: std::io::Error) -> Self {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::AccessDenied(format!("{context} (key is locked or requires SYSTEM)"))
        } else {
            AppError::Registry(format!("{context}: {err}"))
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("json: {e}"))
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
