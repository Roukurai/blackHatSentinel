use collector::{Config, run};

fn main() {
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("collector: {e}");
            std::process::exit(2);
        }
    };
    match run(&config) {
        Ok(stats) => {
            eprintln!(
                "collector done emitted={} skipped={} accepted={} duplicates={}",
                stats.emitted, stats.skipped, stats.accepted, stats.duplicates
            );
        }
        Err(e) => {
            eprintln!("collector: {e}");
            std::process::exit(1);
        }
    }
}
