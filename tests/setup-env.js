// Runs before every test file.
// Self-service funding is now opt-in, so the suite enables it explicitly.
process.env.SANDBOX_DEPOSITS_ENABLED = "true"
