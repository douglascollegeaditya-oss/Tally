export type PoolCategory =
  | 'Vehicles'
  | 'Apartments'
  | 'Furniture'
  | 'Collectibles'
  | 'Hotels'
  | 'Other';

export const POOL_CATEGORIES: readonly PoolCategory[] = [
  'Vehicles',
  'Apartments',
  'Furniture',
  'Collectibles',
  'Hotels',
  'Other',
];

export type PoolStage =
  | 'gathering'
  | 'ready_for_quote'
  | 'quote_requested'
  | 'offer_open'
  | 'unlocked'
  | 'expired'
  | 'closed';

export type PersonaRole = 'buyer' | 'organizer' | 'seller';

export type DemoScenarioId =
  | 'gathering-7-of-8'
  | 'ready-for-quote'
  | 'reviewing-6-of-8'
  | 'just-unlocked'
  | 'missed-deadline';

export interface PersonaIdentity {
  id: string;
  role: PersonaRole;
  name: string;
  shortLabel: string;
  location: string;
  email: string;
  phone: string;
  simulated?: boolean;
}

export interface PoolOptionGroup {
  id: string;
  label: string;
  required: boolean;
  allowedValues: string[];
  allValues: string[]; // includes incompatible choices so buyers can see exclusion logic clearly
}

export interface PoolSpecField {
  label: string;
  value: string;
}

export interface PoolMember {
  id: string;
  userId: string;
  displayName: string;
  location: string;
  quantity: number;
  selectedOptions: Record<string, string>;
  note?: string;
  joinedAt: string;
  status: 'interested' | 'confirmed' | 'passed' | 'waitlisted' | 'fulfilled';
  confirmedVersion?: number;
  confirmedAt?: string;
  fulfilledAt?: string;
  needsReconfirmation?: boolean;
  isSimulated?: boolean;
  // Private contact fields — stripped from public pool views and seller request packets
  privateEmail?: string;
  privatePhone?: string;
}

export interface SellerOffer {
  version: number;
  sellerName: string;
  sellerLocation: string;
  matchingScope: string;
  currency: 'USD';
  unitPrice: number;
  knownFees: number;
  feeLabel: string;
  subtotal: number;
  taxAndRegistrationNote: string;
  minQuantity: number;
  maxQuantity: number;
  fulfillmentMethod: string;
  closeAt: string; // ISO string
  timezoneLabel: string; // e.g., "Pacific"
  claimByDate: string; // ISO date string or formatted date
  publishedAt: string;
  revisionSummary?: string;
  // Private claim instructions shown ONLY to confirmed buyers when unlocked
  privateClaimInstructions: string;
  privateReferencePrefix: string;
}

export interface OfferVersionSnapshot {
  version: number;
  unitPrice: number;
  knownFees: number;
  feeLabel: string;
  subtotal: number;
  minQuantity: number;
  maxQuantity: number;
  closeAt: string;
  claimByDate: string;
  publishedAt: string;
  revisionSummary?: string;
  supersededAt?: string;
}

export interface DiscussionMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: PersonaRole | 'system';
  body: string;
  createdAt: string;
  isOrganizerUpdate?: boolean;
}

export interface ActivityEvent {
  id: string;
  poolId: string;
  poolTitle: string;
  kind:
    | 'joined'
    | 'left'
    | 'organizer_update'
    | 'quote_requested'
    | 'offer_published'
    | 'offer_revised'
    | 'confirmed'
    | 'withdrawn'
    | 'passed'
    | 'unlocked'
    | 'fulfilled'
    | 'expired'
    | 'followed'
    | 'created';
  summary: string;
  createdAt: string;
  isSimulated?: boolean;
}

export interface Pool {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  category: PoolCategory;
  location: string;
  deliveryOrDestination: string;
  unitSingular: string;
  unitPlural: string;
  minQuantity: number;
  maxQuantity: number;
  goalDate: string; // ISO string
  stage: PoolStage;
  imageUrl?: string;
  imageAlt?: string;
  organizerId: string;
  organizerName: string;
  organizerNote: string;
  sharedRequirements: string[];
  categorySpecs: PoolSpecField[];
  optionGroups: PoolOptionGroup[];
  sellerToken?: string;
  quoteRequestedAt?: string;
  currentOffer?: SellerOffer;
  offerHistory: OfferVersionSnapshot[];
  members: PoolMember[];
  discussion: DiscussionMessage[];
  followers: string[];
  outcomeSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface VariantBreakdownRow {
  variantLabel: string;
  eligibleUnits: number;
  memberCount: number;
}

export interface PoolMetrics {
  effectiveStage: PoolStage;
  eligibleInterestedUnits: number;
  excludedUnits: number;
  confirmedUnits: number;
  fulfilledUnits: number;
  waitlistUnits: number;
  passedUnits: number;
  targetMin: number;
  targetCap: number;
  remainingToMinimum: number;
  isCapReached: boolean;
  isExpired: boolean;
  variantBreakdown: VariantBreakdownRow[];
}

export interface DemoSessionState {
  sessionId: string;
  scenarioId: DemoScenarioId;
  demoNow: string;
  pools: Pool[];
  activity: ActivityEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface JoinPoolInput {
  quantity: number;
  selectedOptions: Record<string, string>;
  note?: string;
}

export interface CreatePoolInput {
  title: string;
  subtitle?: string;
  category: PoolCategory;
  location: string;
  deliveryOrDestination: string;
  unitSingular: string;
  unitPlural: string;
  minQuantity: number;
  maxQuantity?: number;
  goalDate: string;
  organizerNote: string;
  sharedRequirements: string[];
  categorySpecs: PoolSpecField[];
  primaryOptionLabel?: string;
  primaryOptionValues?: string[];
}

export interface PublishOfferInput {
  sellerName: string;
  sellerLocation: string;
  matchingScope: string;
  currency: 'USD';
  unitPrice: number;
  knownFees: number;
  feeLabel: string;
  taxAndRegistrationNote: string;
  minQuantity: number;
  maxQuantity: number;
  fulfillmentMethod: string;
  closeAt: string;
  timezoneLabel: string;
  claimByDate: string;
  privateClaimInstructions: string;
  revisionSummary?: string;
}

export interface DomainActionError {
  code:
    | 'NOT_FOUND'
    | 'FORBIDDEN_ROLE'
    | 'VALIDATION_ERROR'
    | 'INVALID_STAGE'
    | 'INELIGIBLE_MEMBER'
    | 'STALE_OFFER_VERSION'
    | 'OFFER_EXPIRED'
    | 'CAP_REACHED'
    | 'ALREADY_LOCKED'
    | 'NOT_CONFIRMED';
  message: string;
  fieldErrors?: Record<string, string>;
  currentVersion?: number;
}

export interface EngineResult<T> {
  ok: true;
  data: T;
  state: DemoSessionState;
}

export interface EngineFailure {
  ok: false;
  error: DomainActionError;
}

export type EngineOutcome<T> = EngineResult<T> | EngineFailure;
