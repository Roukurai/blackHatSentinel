fn main() {
    let code = sentinel_responder::run(std::env::args().skip(1));
    std::process::exit(code);
}
