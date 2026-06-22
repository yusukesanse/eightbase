// Mock environment variables (runs before tests via setupFiles)
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAHudeSA/x3hB2f+2NRkJLA\n-----END RSA PRIVATE KEY-----";
process.env.FIREBASE_STORAGE_BUCKET = "test-project.appspot.com";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@test.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAHudeSA/x3hB2f+2NRkJLA\n-----END RSA PRIVATE KEY-----";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-line-token";
process.env.NEXT_PUBLIC_LIFF_ID = "test-liff-id";
process.env.ADMIN_API_TOKEN = "test-admin-token-12345";
process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
process.env.ADMIN_EMAILS = "admin@example.com";
process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters-long";
process.env.CRON_SECRET = "test-cron-secret";
process.env.ADMIN_ALLOWED_ORIGINS = "http://localhost:3000";
