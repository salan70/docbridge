#![deny(clippy::print_stdout, clippy::print_stderr, clippy::exit)]

pub mod cli;
mod cli_lifecycle;
pub mod config;
pub mod docs;
pub mod lifecycle;
pub mod markdown;
pub mod model;
pub mod output;
mod paths;
pub mod project;
pub mod query;
