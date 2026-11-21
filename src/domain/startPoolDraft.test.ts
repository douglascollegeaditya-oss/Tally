import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDraftFromSearchPrefill,
  INITIAL_START_POOL_DRAFT,
  resolveInitialStartPoolDraft,
  type StartPoolDraftState,
} from './startPoolDraft.ts';

test('search prefill without category leaves category explicitly unselected instead of defaulting to Furniture', () => {
  const resolved = resolveInitialStartPoolDraft(null, {
    q: 'Ford Maverick',
    cat: null,
    loc: null,
  });

  assert.equal(resolved.draft.title, 'Ford Maverick');
  assert.equal(resolved.draft.category, '');
  assert.equal(resolved.prefilledWithoutCategory, true);
  assert.equal(resolved.pendingSearchPrefill, null);
  assert.equal(resolved.draft.userEdited, false);
});

test('search prefill with known valid category preselects that category cleanly', () => {
  const resolved = resolveInitialStartPoolDraft(null, {
    q: 'Ford Maverick',
    cat: 'Vehicles',
    loc: 'Seattle metro',
  });

  assert.equal(resolved.draft.title, 'Ford Maverick');
  assert.equal(resolved.draft.category, 'Vehicles');
  assert.equal(resolved.draft.location, 'Seattle metro');
  assert.equal(resolved.prefilledWithoutCategory, false);
  assert.equal(resolved.pendingSearchPrefill, null);
});

test('search prefill with invalid category value ignores it and stays unselected', () => {
  const resolved = resolveInitialStartPoolDraft(null, {
    q: 'Ford Maverick',
    cat: 'All',
  });

  assert.equal(resolved.draft.title, 'Ford Maverick');
  assert.equal(resolved.draft.category, '');
  assert.equal(resolved.prefilledWithoutCategory, true);
});

test('legacy untouched default Furniture draft in storage does not leak Furniture onto a broad search prefill', () => {
  const legacyUntouched: Partial<StartPoolDraftState> = {
    category: 'Furniture',
    title: '',
    location: 'Portland metro',
    requirementsText: '',
    organizerNote: '',
  };

  const resolved = resolveInitialStartPoolDraft(legacyUntouched, {
    q: 'Ford Maverick',
  });

  assert.equal(resolved.draft.title, 'Ford Maverick');
  assert.equal(resolved.draft.category, '');
  assert.equal(resolved.prefilledWithoutCategory, true);
});

test('valid existing user draft is preserved when reopening /start without query params', () => {
  const saved: StartPoolDraftState = {
    ...INITIAL_START_POOL_DRAFT,
    category: 'Furniture',
    title: 'Solid White Oak Dining Bench',
    location: 'Portland metro',
    requirementsText: 'Natural oil finish',
    userEdited: true,
  };

  const resolved = resolveInitialStartPoolDraft(saved, {});

  assert.equal(resolved.draft.title, 'Solid White Oak Dining Bench');
  assert.equal(resolved.draft.category, 'Furniture');
  assert.equal(resolved.draft.requirementsText, 'Natural oil finish');
  assert.equal(resolved.prefilledWithoutCategory, false);
  assert.equal(resolved.pendingSearchPrefill, null);
});

test('valid existing user draft is NOT silently overwritten by a different Explore search prefill', () => {
  const saved: StartPoolDraftState = {
    ...INITIAL_START_POOL_DRAFT,
    category: 'Furniture',
    title: 'Solid White Oak Dining Bench',
    requirementsText: 'Natural oil finish',
    userEdited: true,
  };

  const resolved = resolveInitialStartPoolDraft(saved, {
    q: 'Ford Maverick',
    cat: null,
  });

  // Existing user draft stays intact
  assert.equal(resolved.draft.title, 'Solid White Oak Dining Bench');
  assert.equal(resolved.draft.category, 'Furniture');
  assert.equal(resolved.prefilledWithoutCategory, false);
  // Incoming search prefill is surfaced explicitly so user can opt in
  assert.deepEqual(resolved.pendingSearchPrefill, {
    title: 'Ford Maverick',
    category: '',
    location: undefined,
  });

  // Choosing the opt-in prefill switches cleanly with unselected category
  const switched = buildDraftFromSearchPrefill({
    q: resolved.pendingSearchPrefill?.title,
    cat: resolved.pendingSearchPrefill?.category || null,
    loc: resolved.pendingSearchPrefill?.location ?? null,
  });
  assert.equal(switched.title, 'Ford Maverick');
  assert.equal(switched.category, '');
});
