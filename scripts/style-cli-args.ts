export function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct !== undefined) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function requiredArgument(name: string): string {
  const value = argument(name);
  if (value === undefined || value.trim() === '') throw new Error(`Missing --${name}`);
  return value;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
