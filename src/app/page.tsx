export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1>🚀 SocialPulse AI — Agency Telegram Strategist Bot</h1>
      <p>
        Your Next.js + grammY Telegram webhook server is running.
      </p>
      <ul>
        <li>
          <strong>Webhook Endpoint:</strong> <code>/api/telegram</code>
        </li>
        <li>
          <strong>One-Click Webhook Setup:</strong>{" "}
          <a href="/api/telegram?setup=true">/api/telegram?setup=true</a>
        </li>
      </ul>
    </main>
  );
}
