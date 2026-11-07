try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`, {
    headers: { authorization: `Bearer ${process.env.API_TOKEN ?? ''}` },
    signal: AbortSignal.timeout(4000),
  });
  const health = await response.json();
  if (!response.ok || !health.ok || !health.opcua?.running) process.exit(1);
} catch {
  process.exit(1);
}
