use std::io;

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("{context}")]
    Io {
        context: String,
        #[source]
        source: io::Error,
    },
    #[error("failed to execute `{command}`")]
    CommandLaunch {
        command: String,
        #[source]
        source: io::Error,
    },
    #[error("{context}")]
    Http {
        context: String,
        #[source]
        source: reqwest::Error,
    },
}

impl AppError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }

    pub fn io(context: impl Into<String>, source: io::Error) -> Self {
        Self::Io {
            context: context.into(),
            source,
        }
    }

    pub fn command_launch(command: impl Into<String>, source: io::Error) -> Self {
        Self::CommandLaunch {
            command: command.into(),
            source,
        }
    }

    pub fn http(context: impl Into<String>, source: reqwest::Error) -> Self {
        Self::Http {
            context: context.into(),
            source,
        }
    }
}
