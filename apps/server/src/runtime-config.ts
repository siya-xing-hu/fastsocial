export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveHost(environment: RuntimeEnvironment = process.env): string {
  return environment.FAST_SOCIAL_HOST?.trim() || "127.0.0.1";
}

export function resolvePort(environment: RuntimeEnvironment = process.env): number {
  const configuredPort = environment.FAST_SOCIAL_PORT?.trim();
  if (!configuredPort) return 5127;

  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("FAST_SOCIAL_PORT must be an integer between 0 and 65535");
  }
  return port;
}
