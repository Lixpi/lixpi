// Checks Lixpi's Rust source conventions on rust-analyzer's lossless syntax
// tree, the way check-go-source does for Go. `--fix` rewrites the spacing
// rules in place; block comments are only reported.
//
//   check-rust-source [--fix] [path...]

use std::{
    fs,
    io,
    path::{
        Path,
        PathBuf,
    },
    process::ExitCode,
};

use lixpi_rust_quality_tools::{
    Report,
    check,
    line_column,
};

fn main() -> ExitCode {
    let mut arguments: Vec<String> = std::env::args().skip(1).collect();
    let fix = arguments.first().is_some_and(|argument| argument == "--fix");
    if fix {
        arguments.remove(0);
    }

    if arguments.is_empty() {
        arguments.push(String::from("."));
    }

    let mut issues = 0;
    let mut failed = false;

    for root in &arguments {
        let mut files = Vec::new();
        if let Err(error) = collect_rust_files(Path::new(root), &mut files) {
            eprintln!("check Rust source root {root:?}: {error}");
            failed = true;

            continue;
        }

        for file in files {
            match check_file(&file, fix) {
                Ok(file_issues) => issues += file_issues,
                Err(error) => {
                    eprintln!("check Rust source file {}: {error}", file.display());
                    failed = true;
                },
            }
        }
    }

    if failed {
        return ExitCode::from(2);
    }

    if issues > 0 {
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

// Build output and generated trees are not authored source.
fn collect_rust_files(
    path: &Path,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    if path.is_file() {
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path.to_path_buf());
        }

        return Ok(());
    }

    let mut entries = fs::read_dir(path)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(fs::DirEntry::path);

    for entry in entries {
        let entry_path = entry.path();
        let name = entry.file_name();
        let skipped = name == "target" || name == "gen" || name.to_string_lossy().starts_with('.');
        if entry.file_type()?.is_dir() && skipped {
            continue;
        }

        collect_rust_files(&entry_path, files)?;
    }

    Ok(())
}

fn check_file(
    path: &Path,
    fix: bool,
) -> Result<usize, String> {
    let source = fs::read_to_string(path).map_err(|error| format!("read source: {error}"))?;
    let Report {
        diagnostics,
        fixed,
    } = check(&source).map_err(|error| format!("parse source: {error}"))?;
    let mut issues = 0;

    for diagnostic in &diagnostics {
        if fix && diagnostic.fixable {
            continue;
        }

        let (line, column) = line_column(&source, diagnostic.offset);
        eprintln!("{}:{line}:{column}: {} ({})", path.display(), diagnostic.message, diagnostic.rule);
        issues += 1;
    }

    if fix && fixed != source {
        fs::write(path, fixed).map_err(|error| format!("write fixed source: {error}"))?;
    }

    Ok(issues)
}
