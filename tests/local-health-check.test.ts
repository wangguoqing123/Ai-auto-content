import { describe, expect, it } from 'vitest';
import { parseDoctorOutput } from '../src/local-runtime/health-check.js';

describe('OpenCLI doctor output parsing', () => {
  it('requires all three positive diagnostics', () => {
    expect(parseDoctorOutput('Daemon: OK\nExtension: connected\nConnectivity: OK')).toEqual({
      daemon: true, extension: true, connectivity: true,
    });
  });

  it('does not trust a successful process when Extension is disconnected', () => {
    expect(parseDoctorOutput('Daemon: OK\nExtension: not connected\nConnectivity: failed')).toEqual({
      daemon: true, extension: false, connectivity: false,
    });
  });

  it('does not infer missing diagnostics from an exit code or generic text', () => {
    expect(parseDoctorOutput('Everything looks fine')).toEqual({ daemon: false, extension: false, connectivity: false });
  });
});
