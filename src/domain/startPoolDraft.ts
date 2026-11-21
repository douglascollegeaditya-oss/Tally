import { POOL_CATEGORIES, type PoolCategory } from './types.ts';

export interface StartPoolDraftState {
  category: PoolCategory | '';
  title: string;
  subtitle: string;
  location: string;
  deliveryOrDestination: string;
  minQuantity: number;
  maxQuantity: number;
  goalDate: string;
  organizerNote: string;
  requirementsText: string;
  // Category-specific typed fields
  vehModel: string;
  vehTrim: string;
  aptMoveIn: string;
  aptUnitSize: string;
  furnSku: string;
  furnDelivery: string;
  collEdition: string;
  collCondition: string;
  hotelDest: string;
  hotelCheckIn: string;
  hotelCheckOut: string;
  hotelRoomType: string;
  otherUnitSingular: string;
  otherUnitPlural: string;
  // Distinguishes deliberate user edits from untouched default templates
  userEdited?: boolean;
}

export interface StartPoolUrlPrefill {
  q?: string | null;
  cat?: string | null;
  loc?: string | null;
}

export interface ResolvedStartPoolDraft {
  draft: StartPoolDraftState;
  prefilledWithoutCategory: boolean;
  pendingSearchPrefill: {
    title: string;
    category: PoolCategory | '';
    location?: string;
  } | null;
}

export const INITIAL_START_POOL_DRAFT: StartPoolDraftState = {
  category: '',
  title: '',
  subtitle: '',
  location: 'Portland metro',
  deliveryOrDestination: '',
  minQuantity: 6,
  maxQuantity: 10,
  goalDate: '2026-12-28',
  organizerNote: '',
  requirementsText: '',
  vehModel: '',
  vehTrim: '',
  aptMoveIn: '2027-02-01',
  aptUnitSize: '',
  furnSku: '',
  furnDelivery: '',
  collEdition: '',
  collCondition: '',
  hotelDest: '',
  hotelCheckIn: '2027-01-22',
  hotelCheckOut: '2027-01-24',
  hotelRoomType: '',
  otherUnitSingular: 'home',
  otherUnitPlural: 'homes',
  userEdited: false,
};

export function parseValidPoolCategory(raw?: string | null): PoolCategory | '' {
  if (!raw) return '';
  return POOL_CATEGORIES.includes(raw as PoolCategory) ? (raw as PoolCategory) : '';
}

/**
 * Determines whether a stored draft contains genuine user-entered content
 * rather than an untouched legacy default template.
 */
export function hasSubstantiveSavedDraft(
  saved: Partial<StartPoolDraftState> | null | undefined
): boolean {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.userEdited === true) {
    return (
      Boolean(saved.title?.trim()) ||
      Boolean(parseValidPoolCategory(saved.category)) ||
      Boolean(saved.requirementsText?.trim()) ||
      Boolean(saved.organizerNote?.trim())
    );
  }
  // Legacy saved drafts (before userEdited flag) are only treated as substantive
  // if the user actually entered a title, requirements, or organizer note.
  return (
    Boolean(saved.title?.trim()) ||
    Boolean(saved.requirementsText?.trim()) ||
    Boolean(saved.organizerNote?.trim())
  );
}

/**
 * Builds a clean search-prefilled draft from Explore/Comparison URL params.
 * Never silently defaults to an unrelated category when category is omitted.
 */
export function buildDraftFromSearchPrefill(prefill: StartPoolUrlPrefill): StartPoolDraftState {
  const cleanQ = prefill.q?.trim() ?? '';
  const validCat = parseValidPoolCategory(prefill.cat);
  const cleanLoc = prefill.loc?.trim();
  return {
    ...INITIAL_START_POOL_DRAFT,
    title: cleanQ,
    category: validCat,
    location:
      cleanLoc && cleanLoc !== 'All locations'
        ? cleanLoc
        : INITIAL_START_POOL_DRAFT.location,
    userEdited: false,
  };
}

/**
 * Resolves the initial StartPool form state from any persisted draft and URL search params.
 * - Preserves valid existing user drafts without silently overwriting their choices.
 * - When launching from a broad search without a category, leaves category explicitly unselected ('').
 * - When a valid existing draft conflicts with a new search prefill, preserves the existing draft
 *   and exposes `pendingSearchPrefill` so the user can deliberately choose to switch.
 */
export function resolveInitialStartPoolDraft(
  saved: Partial<StartPoolDraftState> | null | undefined,
  urlPrefill: StartPoolUrlPrefill
): ResolvedStartPoolDraft {
  const cleanQ = urlPrefill.q?.trim() ?? '';
  const validCat = parseValidPoolCategory(urlPrefill.cat);
  const cleanLoc = urlPrefill.loc?.trim();
  const validLoc = cleanLoc && cleanLoc !== 'All locations' ? cleanLoc : undefined;
  const hasUrlSearch = Boolean(cleanQ || validCat || validLoc);

  const isSavedSubstantive = hasSubstantiveSavedDraft(saved);

  if (isSavedSubstantive && saved) {
    const normalizedSaved: StartPoolDraftState = {
      ...INITIAL_START_POOL_DRAFT,
      ...saved,
      category: parseValidPoolCategory(saved.category),
      userEdited: true,
    };

    const sameTitle =
      cleanQ !== '' &&
      normalizedSaved.title.trim().toLowerCase() === cleanQ.toLowerCase();
    const sameCategory = !validCat || normalizedSaved.category === validCat;

    if (hasUrlSearch && cleanQ && (!sameTitle || !sameCategory)) {
      return {
        draft: normalizedSaved,
        prefilledWithoutCategory: false,
        pendingSearchPrefill: {
          title: cleanQ,
          category: validCat,
          location: validLoc,
        },
      };
    }

    return {
      draft: normalizedSaved,
      prefilledWithoutCategory: false,
      pendingSearchPrefill: null,
    };
  }

  if (hasUrlSearch) {
    const draft = buildDraftFromSearchPrefill(urlPrefill);
    return {
      draft,
      prefilledWithoutCategory: Boolean(cleanQ) && draft.category === '',
      pendingSearchPrefill: null,
    };
  }

  return {
    draft: { ...INITIAL_START_POOL_DRAFT },
    prefilledWithoutCategory: false,
    pendingSearchPrefill: null,
  };
}
