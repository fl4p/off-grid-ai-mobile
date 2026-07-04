import { useDownloadStore, isActiveStatus, DownloadEntry } from '../../../src/stores/downloadStore';

const makeEntry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  modelKey: 'author/model/model.gguf',
  downloadId: 'dl-1',
  modelId: 'author/model',
  fileName: 'model.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text',
  status: 'pending',
  bytesDownloaded: 0,
  totalBytes: 1000,
  combinedTotalBytes: 1000,
  progress: 0,
  createdAt: 1000,
  ...overrides,
});

beforeEach(() => {
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
});

describe('isActiveStatus', () => {
  it('returns true for active statuses', () => {
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('running')).toBe(true);
    expect(isActiveStatus('retrying')).toBe(true);
    expect(isActiveStatus('waiting_for_network')).toBe(true);
    expect(isActiveStatus('processing')).toBe(true);
  });

  it('returns false for terminal statuses', () => {
    expect(isActiveStatus('completed')).toBe(false);
    expect(isActiveStatus('failed')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
  });
});

describe('add', () => {
  it('adds a new entry and indexes downloadId', () => {
    const entry = makeEntry();
    useDownloadStore.getState().add(entry);
    const state = useDownloadStore.getState();
    expect(state.downloads['author/model/model.gguf']).toBeDefined();
    expect(state.downloadIdIndex['dl-1']).toBe('author/model/model.gguf');
  });

  it('ignores duplicate modelKey', () => {
    const entry = makeEntry();
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().add({ ...entry, downloadId: 'dl-2' });
    expect(useDownloadStore.getState().downloadIdIndex['dl-2']).toBeUndefined();
  });

  it('indexes mmProjDownloadId when present', () => {
    const entry = makeEntry({ mmProjDownloadId: 'dl-mm-1' });
    useDownloadStore.getState().add(entry);
    expect(useDownloadStore.getState().downloadIdIndex['dl-mm-1']).toBe('author/model/model.gguf');
  });
});

describe('setAll', () => {
  it('replaces all entries', () => {
    useDownloadStore.getState().add(makeEntry({ modelKey: 'old/model/old.gguf', downloadId: 'old-dl' }));
    const newEntry = makeEntry({ modelKey: 'new/model/new.gguf', downloadId: 'new-dl' });
    useDownloadStore.getState().setAll([newEntry]);
    const state = useDownloadStore.getState();
    expect(state.downloads['old/model/old.gguf']).toBeUndefined();
    expect(state.downloads['new/model/new.gguf']).toBeDefined();
  });
});

describe('hydrate', () => {
  it('adds new entries', () => {
    const entry = makeEntry({ bytesDownloaded: 300 });
    useDownloadStore.getState().hydrate([entry]);
    expect(useDownloadStore.getState().downloads['author/model/model.gguf']).toBeDefined();
  });

  it('keeps existing entry when local progress is ahead', () => {
    const existing = makeEntry({ bytesDownloaded: 600, status: 'running' });
    useDownloadStore.getState().add(existing);
    const incoming = makeEntry({ bytesDownloaded: 400, totalBytes: 2000 });
    useDownloadStore.getState().hydrate([incoming]);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.bytesDownloaded).toBe(600);
    expect(entry.totalBytes).toBe(2000);
  });

  it('replaces existing entry when native is ahead', () => {
    const existing = makeEntry({ bytesDownloaded: 200 });
    useDownloadStore.getState().add(existing);
    const incoming = makeEntry({ bytesDownloaded: 500 });
    useDownloadStore.getState().hydrate([incoming]);
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].bytesDownloaded).toBe(500);
  });
});

describe('updateProgress', () => {
  it('updates bytes and progress', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().updateProgress('dl-1', 500, 1000);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.bytesDownloaded).toBe(500);
    expect(entry.progress).toBe(0.5);
    expect(entry.status).toBe('running');
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().updateProgress('unknown', 100, 1000);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });

  it('sets downloadSpeed to 0 on first progress update', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().updateProgress('dl-1', 100, 1000);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadSpeed).toBe(0);
    expect(entry.lastSpeedUpdate).toBeDefined();
  });

  it('computes smoothed downloadSpeed on subsequent updates', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().updateProgress('dl-1', 100, 1000);
    const ts1 = useDownloadStore.getState().downloads['author/model/model.gguf'].lastSpeedUpdate!;
    // Simulate 500ms passing, 200 bytes downloaded
    const entry1 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    // Manually advance lastSpeedUpdate to simulate time passing
    useDownloadStore.setState({
      downloads: {
        ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...entry1, lastSpeedUpdate: ts1 - 500 },
      },
    });
    useDownloadStore.getState().updateProgress('dl-1', 300, 1000);
    const entry2 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    // 200 bytes in ~500ms = ~400 bytes/sec instant; EMA with prev=0 gives instant
    expect(entry2.downloadSpeed).toBeCloseTo(400, 1);
  });

  it('does not inflate speed when events arrive in a coalesced burst', () => {
    // Regression: Android WorkManager / RN bridge can flush several progress
    // events within ~1ms of each other. Dividing a real byte-delta by that near
    // -zero time gap used to report absurd speeds (e.g. 150 MB/s for a ~5 MB/s
    // download). A sub-window burst must hold the last speed, not spike.
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: 100_000_000 }));
    // Seed the anchor.
    useDownloadStore.getState().updateProgress('dl-1', 1_000_000, 100_000_000);
    // A flurry of events with real byte deltas but no rewind of the anchor time
    // (they land within the same window). Speed must stay 0, never spike.
    useDownloadStore.getState().updateProgress('dl-1', 2_000_000, 100_000_000);
    useDownloadStore.getState().updateProgress('dl-1', 3_000_000, 100_000_000);
    const burst = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(burst.downloadSpeed).toBe(0);
    expect(burst.bytesDownloaded).toBe(3_000_000); // bytes still advance
    // Once a real window elapses, it measures from the ORIGINAL anchor over true
    // elapsed time: 4 MB over 1000ms = ~4 MB/s, not the burst-inflated value.
    const e = useDownloadStore.getState().downloads['author/model/model.gguf'];
    useDownloadStore.setState({
      downloads: {
        ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...e, lastSpeedUpdate: e.lastSpeedUpdate! - 1000 },
      },
    });
    useDownloadStore.getState().updateProgress('dl-1', 5_000_000, 100_000_000);
    const measured = useDownloadStore.getState().downloads['author/model/model.gguf'];
    // ~4 MB/s (a few ms of real Date.now jitter aside), nowhere near the
    // burst-inflated value that dividing by a ~1ms gap would produce.
    expect(measured.downloadSpeed).toBeGreaterThan(3_500_000);
    expect(measured.downloadSpeed).toBeLessThan(4_500_000);
  });

  // Helper: seed the anchor then establish a real ~4000 B/s reading. Returns the
  // exact seeded speed (a few B/s off 4000 due to real Date.now jitter) so callers
  // assert relative to it rather than to a brittle literal.
  const KEY = 'author/model/model.gguf';
  const seedRunningAt4000 = (): number => {
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: 100000 }));
    useDownloadStore.getState().updateProgress('dl-1', 1000, 100000); // seed anchor
    const e1 = useDownloadStore.getState().downloads[KEY];
    useDownloadStore.setState({
      downloads: { ...useDownloadStore.getState().downloads,
        [KEY]: { ...e1, lastSpeedUpdate: e1.lastSpeedUpdate! - 1000 } },
    });
    useDownloadStore.getState().updateProgress('dl-1', 5000, 100000); // 4000 B in ~1000ms
    const speed = useDownloadStore.getState().downloads[KEY].downloadSpeed!;
    expect(speed).toBeGreaterThan(3900); // ~4000 modulo clock jitter
    expect(speed).toBeLessThan(4100);
    return speed;
  };
  const rewindAnchor = (ms: number) => {
    const e = useDownloadStore.getState().downloads[KEY];
    useDownloadStore.setState({
      downloads: { ...useDownloadStore.getState().downloads, [KEY]: { ...e, lastSpeedUpdate: e.lastSpeedUpdate! - ms } },
    });
  };

  // Regression: a vision GGUF's completion echo (onAnyComplete re-reports the
  // same final byte count while the mmproj sidecar is still transferring) is
  // routed via updateProgressBytesOnly, so it must NOT touch speed/anchor.
  it('leaves speed untouched on an updateProgressBytesOnly completion echo', () => {
    const seeded = seedRunningAt4000();
    const anchorBefore = useDownloadStore.getState().downloads[KEY].speedAnchorBytes;
    rewindAnchor(1000);
    useDownloadStore.getState().updateProgressBytesOnly('dl-1', 5000, 100000); // echo
    const e3 = useDownloadStore.getState().downloads[KEY];
    expect(e3.downloadSpeed).toBe(seeded);              // unchanged
    expect(e3.speedAnchorBytes).toBe(anchorBefore);     // anchor untouched
  });

  // A genuine stall (iOS re-polls the same byte count every 1.5s over a hung
  // connection) DOES cross the window with a real updateProgress and must decay
  // the EMA toward 0 (instantSpeed 0 blended in), not freeze the last rate.
  it('decays speed toward 0 on a real zero-delta stall poll', () => {
    const seeded = seedRunningAt4000();
    rewindAnchor(1000);
    useDownloadStore.getState().updateProgress('dl-1', 5000, 100000); // same bytes, real poll
    const e3 = useDownloadStore.getState().downloads[KEY];
    expect(e3.downloadSpeed).toBeCloseTo(seeded * 0.7, 5); // 0.7*prev + 0.3*0 — decaying
  });

  // Date.now() is not monotonic: a backward clock jump (NTP/manual) makes deltaMs
  // negative. Without re-anchoring, the sub-window branch would be taken forever
  // and freeze a stale rate. It must re-anchor to the current sample and hold.
  it('re-anchors and holds speed when the wall clock jumps backward', () => {
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: 100000 }));
    useDownloadStore.getState().updateProgress('dl-1', 1000, 100000);
    const e1 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    const future = e1.lastSpeedUpdate! + 100000; // anchor set in the future
    useDownloadStore.setState({
      downloads: { ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...e1, downloadSpeed: 3000, speedAnchorBytes: 1000, lastSpeedUpdate: future } },
    });
    useDownloadStore.getState().updateProgress('dl-1', 2000, 100000); // now - future < 0
    const e2 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(e2.downloadSpeed).toBe(3000);          // held, no garbage from negative deltaMs
    expect(e2.speedAnchorBytes).toBe(2000);       // re-anchored to current bytes
    expect(e2.lastSpeedUpdate!).toBeLessThan(future); // anchor time reset to ~now
  });
});

describe('updateMmProjProgress', () => {
  it('updates mmproj bytes and combined progress', () => {
    const entry = makeEntry({ combinedTotalBytes: 2000, mmProjDownloadId: 'dl-mm' });
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().updateMmProjProgress('dl-mm', 400);
    const updated = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(updated.mmProjBytesDownloaded).toBe(400);
    expect(updated.progress).toBe(0.2);
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().updateMmProjProgress('unknown', 100);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });

  it('computes downloadSpeed from combined bytes delta', () => {
    const entry = makeEntry({ combinedTotalBytes: 2000, mmProjDownloadId: 'dl-mm', bytesDownloaded: 500 });
    useDownloadStore.getState().add(entry);
    // First update sets lastSpeedUpdate
    useDownloadStore.getState().updateMmProjProgress('dl-mm', 100);
    const ts1 = useDownloadStore.getState().downloads['author/model/model.gguf'].lastSpeedUpdate!;
    // Advance time by 1000ms and add 200 bytes
    const e1 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    useDownloadStore.setState({
      downloads: {
        ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...e1, lastSpeedUpdate: ts1 - 1000 },
      },
    });
    useDownloadStore.getState().updateMmProjProgress('dl-mm', 300);
    const updated = useDownloadStore.getState().downloads['author/model/model.gguf'];
    // 200 bytes in ~1000ms = ~200 bytes/sec
    expect(updated.downloadSpeed).toBeCloseTo(200, 0);
  });

  it('smooths speed via EMA on third update', () => {
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: 100000 }));
    // First update — establishes baseline, speed = 0
    useDownloadStore.getState().updateProgress('dl-1', 1000, 100000);
    const e1 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    // Second update — 4000 bytes in 1000ms = 4000 B/s, prevSpeed=0 → speed=4000
    useDownloadStore.setState({
      downloads: {
        ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...e1, lastSpeedUpdate: e1.lastSpeedUpdate! - 1000 },
      },
    });
    useDownloadStore.getState().updateProgress('dl-1', 5000, 100000);
    const e2 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(e2.downloadSpeed).toBeCloseTo(4000, 0);
    // Third update — 2000 bytes in 1000ms = 2000 B/s, EMA: 4000*0.7 + 2000*0.3 = 3400
    useDownloadStore.setState({
      downloads: {
        ...useDownloadStore.getState().downloads,
        'author/model/model.gguf': { ...e2, lastSpeedUpdate: e2.lastSpeedUpdate! - 1000 },
      },
    });
    useDownloadStore.getState().updateProgress('dl-1', 7000, 100000);
    const e3 = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(e3.downloadSpeed).toBeCloseTo(3400, 0);
  });
});

describe('setStatus', () => {
  it('updates main entry status', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'err', code: 'http_404' });
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.status).toBe('failed');
    expect(entry.errorMessage).toBe('err');
  });

  it('updates mmproj status independently', () => {
    const entry = makeEntry({ mmProjDownloadId: 'dl-mm' });
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().setStatus('dl-mm', 'failed', { message: 'mmproj err' });
    const updated = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(updated.status).toBe('pending');
    expect(updated.mmProjStatus).toBe('failed');
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().setStatus('unknown', 'failed');
    expect(useDownloadStore.getState().downloads).toBe(before);
  });

  it('clears downloadSpeed on failed status', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running', downloadSpeed: 5000, lastSpeedUpdate: 12345 }));
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'err' });
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadSpeed).toBe(0);
    expect(entry.lastSpeedUpdate).toBeUndefined();
  });

  // A WiFi blip is the most common real-world interruption on mobile. Native
  // reports it as a waiting_for_network / retrying transition through setStatus,
  // and both are ACTIVE_STATUSES, so the ModelCard-based screens keep rendering
  // the entry as downloading. If the stale speed isn't cleared, they show a
  // frozen "5.0 MB/s" next to a progress bar that never moves.
  it.each(['waiting_for_network', 'retrying'] as const)(
    'clears downloadSpeed and anchor when paused with %s status',
    (status) => {
      useDownloadStore.getState().add(makeEntry({ status: 'running', downloadSpeed: 5000, lastSpeedUpdate: 12345, speedAnchorBytes: 1000 }));
      useDownloadStore.getState().setStatus('dl-1', status);
      const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
      expect(entry.status).toBe(status);
      expect(entry.downloadSpeed).toBe(0);
      expect(entry.lastSpeedUpdate).toBeUndefined();
      expect(entry.speedAnchorBytes).toBeUndefined();
    },
  );

  // Vision models download a GGUF plus an mmproj sidecar sharing one combined
  // (bytes, time) speed anchor. When the GGUF has already finished, entry.status
  // stays 'running' and the ONLY stall signal is the sidecar's own status. A
  // sidecar pause/stop must clear the shared speed too, or the card freezes a
  // stale rate on a download that is no longer moving bytes.
  it.each(['waiting_for_network', 'retrying', 'failed'] as const)(
    'clears the shared downloadSpeed and anchor when the mmproj sidecar goes %s',
    (status) => {
      useDownloadStore.getState().add(makeEntry({
        status: 'running', downloadSpeed: 5000, lastSpeedUpdate: 12345, speedAnchorBytes: 1000,
        mmProjDownloadId: 'dl-mm',
      }));
      useDownloadStore.getState().setStatus('dl-mm', status);
      const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
      expect(entry.status).toBe('running'); // main entry unaffected
      expect(entry.mmProjStatus).toBe(status);
      expect(entry.downloadSpeed).toBe(0);
      expect(entry.lastSpeedUpdate).toBeUndefined();
      expect(entry.speedAnchorBytes).toBeUndefined();
    },
  );

  it('keeps the shared downloadSpeed while the mmproj sidecar is still running', () => {
    useDownloadStore.getState().add(makeEntry({
      status: 'running', downloadSpeed: 5000, lastSpeedUpdate: 12345, speedAnchorBytes: 1000,
      mmProjDownloadId: 'dl-mm',
    }));
    useDownloadStore.getState().setStatus('dl-mm', 'running');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.mmProjStatus).toBe('running');
    expect(entry.downloadSpeed).toBe(5000);
    expect(entry.speedAnchorBytes).toBe(1000);
  });
});

describe('setProcessing / setCompleted', () => {
  it('setProcessing sets status to processing', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running' }));
    useDownloadStore.getState().setProcessing('dl-1');
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].status).toBe('processing');
  });

  it('setCompleted sets status to completed and progress to 1', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running' }));
    useDownloadStore.getState().setCompleted('dl-1');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.status).toBe('completed');
    expect(entry.progress).toBe(1);
  });

  it('setProcessing clears downloadSpeed', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running', downloadSpeed: 3000, lastSpeedUpdate: 999 }));
    useDownloadStore.getState().setProcessing('dl-1');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadSpeed).toBe(0);
    expect(entry.lastSpeedUpdate).toBeUndefined();
  });

  it('setCompleted clears downloadSpeed', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running', downloadSpeed: 3000, lastSpeedUpdate: 999 }));
    useDownloadStore.getState().setCompleted('dl-1');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadSpeed).toBe(0);
    expect(entry.lastSpeedUpdate).toBeUndefined();
  });
});

describe('setMmProjCompleted', () => {
  it('marks mmproj as completed', () => {
    useDownloadStore.getState().add(makeEntry({ mmProjDownloadId: 'dl-mm' }));
    useDownloadStore.getState().setMmProjCompleted('dl-mm', 500);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.mmProjStatus).toBe('completed');
    expect(entry.mmProjBytesDownloaded).toBe(500);
  });

  it('is a no-op for unknown mmProjDownloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().setMmProjCompleted('unknown', 100);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });
});

describe('retryEntry', () => {
  it('resets entry with new downloadId', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'failed', bytesDownloaded: 500 }));
    useDownloadStore.getState().retryEntry('author/model/model.gguf', 'dl-retry');
    const state = useDownloadStore.getState();
    const entry = state.downloads['author/model/model.gguf'];
    expect(entry.downloadId).toBe('dl-retry');
    expect(entry.status).toBe('pending');
    expect(entry.bytesDownloaded).toBe(0);
    expect(state.downloadIdIndex['dl-retry']).toBe('author/model/model.gguf');
    expect(state.downloadIdIndex['dl-1']).toBeUndefined();
  });

  it('resets downloadSpeed and lastSpeedUpdate', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'failed', bytesDownloaded: 500, downloadSpeed: 999, lastSpeedUpdate: 12345 }));
    useDownloadStore.getState().retryEntry('author/model/model.gguf', 'dl-retry');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadSpeed).toBe(0);
    expect(entry.lastSpeedUpdate).toBeUndefined();
  });
});

describe('remove', () => {
  it('removes entry and cleans up index', () => {
    useDownloadStore.getState().add(makeEntry({ mmProjDownloadId: 'dl-mm' }));
    useDownloadStore.getState().remove('author/model/model.gguf');
    const state = useDownloadStore.getState();
    expect(state.downloads['author/model/model.gguf']).toBeUndefined();
    expect(state.downloadIdIndex['dl-1']).toBeUndefined();
    expect(state.downloadIdIndex['dl-mm']).toBeUndefined();
  });

  it('is a no-op for unknown modelKey', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().remove('nonexistent/key');
    expect(useDownloadStore.getState().downloads).toBe(before);
  });
});
