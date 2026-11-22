import type {
  ActivityEvent,
  DemoScenarioId,
  DemoSessionState,
  PersonaIdentity,
  PersonaRole,
  Pool,
  PoolMember,
  SellerOffer,
} from './types.ts';
import {
  buildTrustedPaidPlacement,
  buildTrustedTallyCertification,
} from './vehicleEngine.ts';

export const STITCH_MAVERICK_IMAGE_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAqihXIGQJFeup6mxzGNnVpEe_xQQq_jL1WmSVdqNYBJxDrc3XX-tAnuOxzySc9rvEaAQJAThwa3NRqUht0cXnS2W2UTeNaALGNGxZFcFw-sAld9TrNXjxbLZjH1w7LZ4ThkQQXF54MP_NgS_-9-vopgMLbIWCj0EZqyB7N8MNo6NfvR9cQamP46bdP2iRWqx0uniWH8oiHCQHcvPgQqDqw0KrKvhER5y_SzMy47Vk';

export const GENERATED_IMAGES = {
  walnutTable: '/src/assets/images/walnut_dining_table_1795265627758.jpg',
  burnsideLofts: '/src/assets/images/portland_modern_lofts_1795265630329.jpg',
  hoodLodge: '/src/assets/images/hood_river_lodge_1795265627636.jpg',
} as const;

// Default demo clock: Dec 8, 2026, 10:00 AM Pacific (all seed deadlines are in the future relative to this)
export const DEFAULT_DEMO_NOW = '2026-12-08T18:00:00.000Z';
export const MAVERICK_OFFER_CLOSE_ISO = '2026-12-15T02:00:00.000Z'; // Dec 14, 2026 6:00 PM Pacific
export const MAVERICK_EXPIRED_DEMO_NOW = '2026-12-15T02:15:00.000Z'; // Dec 14, 2026 6:15 PM Pacific

export const PERSONAS: Record<PersonaRole, PersonaIdentity> = {
  buyer: {
    id: 'buyer-maya',
    role: 'buyer',
    name: 'Maya Chen',
    shortLabel: 'Buyer (Maya)',
    location: 'Portland metro',
    email: 'maya.chen@example.invalid',
    phone: '503-555-0148',
  },
  organizer: {
    id: 'org-devon',
    role: 'organizer',
    name: 'Devon Brooks',
    shortLabel: 'Organizer (Devon)',
    location: 'Portland metro',
    email: 'devon.brooks@example.invalid',
    phone: '503-555-0192',
  },
  seller: {
    id: 'seller-alder',
    role: 'seller',
    name: 'Alder Motor Co. — Fleet Desk',
    shortLabel: 'Seller (Alder Motor Co.)',
    location: 'Portland metro',
    email: 'fleet@aldermotor.example.invalid',
    phone: '503-555-0110',
  },
};

export function createMaverickOffer(version = 1): SellerOffer {
  return {
    version,
    sellerName: 'Alder Motor Co.',
    sellerLocation: 'Portland, OR (Fictional demo dealership)',
    matchingScope: '2026 Ford Maverick XLT Hybrid AWD · Portland metro pickup · Standard XLT Equipment Group',
    currency: 'USD',
    unitPrice: 27900,
    knownFees: 395,
    itemizedFees: [{ label: 'Dealer documentation fee', amount: 395, status: 'fixed' }],
    feeLabel: 'Dealer documentation fee',
    subtotal: 28295,
    taxTreatment: 'Excludes Oregon privilege tax, title, and DMV registration (paid by buyer directly at registration).',
    taxAndRegistrationNote: 'Excludes Oregon privilege tax, title, and DMV registration.',
    paymentTerms: 'Direct buyer-to-dealer payment (cash, outside credit union, or dealer loan) at pickup; $0 collected by Tally.',
    includedItems: [
      '2026 Ford Maverick XLT Hybrid AWD (Standard XLT Equipment Group)',
      'Factory destination & delivery to Portland lot',
      'Pre-delivery inspection',
    ],
    excludedItems: [
      'State privilege/sales tax, title, and DMV registration',
      'Optional dealer protection packages, VIN etching, or extended service contracts',
    ],
    quotedVehicle: {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'new',
      make: 'Ford',
      model: 'Maverick',
      year: 2026,
      trim: 'XLT',
      powertrain: 'Hybrid',
      drivetrain: 'AWD',
    },
    minQuantity: 8,
    maxQuantity: 8,
    fulfillmentMethod: 'Direct buyer-to-seller purchase & delivery at Alder Motor Co. (Portland)',
    closeAt: MAVERICK_OFFER_CLOSE_ISO,
    timezoneLabel: 'Pacific',
    claimByDate: '2026-12-20',
    publishedAt: '2026-12-08T17:00:00.000Z',
    revisionSummary:
      version === 1
        ? 'Initial conditional group offer matching 8 XLT Hybrid AWD vehicles.'
        : 'Revised terms by seller.',
    privateClaimInstructions:
      'SIMULATED DEMO INSTRUCTIONS: Present reference code below to Alder Motor Co. Fleet Desk in Portland before Dec 20, 2026 to complete direct buyer-to-seller paperwork and payment. No real payment or reservation has been made.',
    privateReferencePrefix: 'ALDER-MAV-2026',
  };
}

function buildBaseMaverickMembers(scenario: DemoScenarioId): PoolMember[] {
  const baseSixEligible: PoolMember[] = [
    {
      id: 'mem-1',
      userId: 'org-devon',
      displayName: 'Devon Brooks (Organizer)',
      location: 'NE Portland',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Cactus Gray',
        delivery: 'Portland metro pickup',
      },
      note: 'Flexible on color if Cactus Gray is low stock.',
      joinedAt: '2026-12-01T19:10:00.000Z',
      status: 'interested',
      privateEmail: 'devon.brooks@example.invalid',
      privatePhone: '503-555-0192',
    },
    {
      id: 'mem-2',
      userId: 'member-priya',
      displayName: 'Priya N.',
      location: 'Beaverton',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Oxford White',
        delivery: 'Portland metro pickup',
      },
      joinedAt: '2026-12-02T16:20:00.000Z',
      status: 'interested',
      privateEmail: 'priya.n@example.invalid',
      privatePhone: '503-555-0131',
    },
    {
      id: 'mem-3',
      userId: 'member-carlos',
      displayName: 'Carlos M.',
      location: 'SE Portland',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Carbonized Gray',
        delivery: 'Portland metro pickup',
      },
      joinedAt: '2026-12-03T18:45:00.000Z',
      status: 'interested',
      privateEmail: 'carlos.m@example.invalid',
      privatePhone: '503-555-0142',
    },
    {
      id: 'mem-4',
      userId: 'member-hannah',
      displayName: 'Hannah K.',
      location: 'Lake Oswego',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Cactus Gray',
        delivery: 'Portland metro pickup',
      },
      joinedAt: '2026-12-04T20:15:00.000Z',
      status: 'interested',
      privateEmail: 'hannah.k@example.invalid',
      privatePhone: '503-555-0164',
    },
    {
      id: 'mem-5',
      userId: 'member-sam',
      displayName: 'Sam R.',
      location: 'Vancouver, WA',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Hot Pepper Red',
        delivery: 'Portland metro pickup',
      },
      joinedAt: '2026-12-05T15:30:00.000Z',
      status: 'interested',
      privateEmail: 'sam.r@example.invalid',
      privatePhone: '360-555-0177',
    },
    {
      id: 'mem-6',
      userId: 'member-elena',
      displayName: 'Elena V.',
      location: 'Milwaukie',
      quantity: 1,
      selectedOptions: {
        trim: 'XLT Hybrid AWD',
        color: 'Carbonized Gray',
        delivery: 'Portland metro pickup',
      },
      joinedAt: '2026-12-06T22:00:00.000Z',
      status: 'interested',
      privateEmail: 'elena.v@example.invalid',
      privatePhone: '503-555-0185',
    },
  ];

  const seventhEligible: PoolMember = {
    id: 'mem-7',
    userId: 'member-tomas',
    displayName: 'Tomas G.',
    location: 'Hillsboro',
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      color: 'Oxford White',
      delivery: 'Portland metro pickup',
    },
    joinedAt: '2026-12-07T19:00:00.000Z',
    status: 'interested',
    privateEmail: 'tomas.g@example.invalid',
    privatePhone: '503-555-0198',
  };

  const mayaMember: PoolMember = {
    id: 'mem-maya',
    userId: PERSONAS.buyer.id,
    displayName: PERSONAS.buyer.name,
    location: 'Portland metro',
    quantity: 1,
    selectedOptions: {
      trim: 'XLT Hybrid AWD',
      color: 'Cactus Gray',
      delivery: 'Portland metro pickup',
    },
    note: 'Ready for December pickup in Portland.',
    joinedAt: '2026-12-08T16:15:00.000Z',
    status: 'interested',
    privateEmail: PERSONAS.buyer.email,
    privatePhone: PERSONAS.buyer.phone,
  };

  // Excluded member with incompatible preferences to demonstrate transparent exclusion
  const incompatibleMember: PoolMember = {
    id: 'mem-liam-excl',
    userId: 'member-liam',
    displayName: 'Liam O.',
    location: 'Tacoma, WA',
    quantity: 1,
    selectedOptions: {
      trim: 'Lariat EcoBoost (Excluded)',
      color: 'Oxford White',
      delivery: 'Out-of-state shipping',
    },
    note: 'Hoping for Lariat trim with transport to Tacoma.',
    joinedAt: '2026-12-05T19:10:00.000Z',
    status: 'interested',
    privateEmail: 'liam.o@example.invalid',
    privatePhone: '253-555-0122',
  };

  if (scenario === 'gathering-7-of-8') {
    // 7 eligible interested (Maya has NOT joined yet) + 1 incompatible excluded
    return [...baseSixEligible, seventhEligible, incompatibleMember];
  }

  if (scenario === 'ready-for-quote') {
    // 8 eligible interested (including Maya) + 1 incompatible excluded
    return [...baseSixEligible, seventhEligible, mayaMember, incompatibleMember];
  }

  if (scenario === 'reviewing-6-of-8') {
    // 8 eligible members; 6 confirmed on v1, Tomas & Maya still undecided
    const confirmedSix = baseSixEligible.map((m, idx) => ({
      ...m,
      status: 'confirmed' as const,
      confirmedVersion: 1,
      confirmedAt: `2026-12-08T17:${String(10 + idx * 5).padStart(2, '0')}:00.000Z`,
    }));
    return [...confirmedSix, seventhEligible, mayaMember, incompatibleMember];
  }

  if (scenario === 'just-unlocked') {
    // All 8 eligible confirmed on v1 (including Maya), none fulfilled yet
    const allEightConfirmed = [...baseSixEligible, seventhEligible, mayaMember].map((m, idx) => ({
      ...m,
      status: 'confirmed' as const,
      confirmedVersion: 1,
      confirmedAt: `2026-12-08T17:${String(10 + idx * 5).padStart(2, '0')}:00.000Z`,
    }));
    return [...allEightConfirmed, incompatibleMember];
  }

  // missed-deadline: 7 of 8 confirmed (including Maya), Tomas never confirmed, deadline passed
  const sevenConfirmed = [...baseSixEligible, mayaMember].map((m, idx) => ({
    ...m,
    status: 'confirmed' as const,
    confirmedVersion: 1,
    confirmedAt: `2026-12-10T18:${String(10 + idx * 5).padStart(2, '0')}:00.000Z`,
  }));
  return [...sevenConfirmed, seventhEligible, incompatibleMember];
}

export function buildMaverickPool(scenario: DemoScenarioId): Pool {
  const members = buildBaseMaverickMembers(scenario);
  const offer = createMaverickOffer(1);

  const stageByScenario: Record<DemoScenarioId, Pool['stage']> = {
    'gathering-7-of-8': 'gathering',
    'ready-for-quote': 'ready_for_quote',
    'reviewing-6-of-8': 'offer_open',
    'just-unlocked': 'unlocked',
    'missed-deadline': 'expired',
  };

  const hasOffer =
    scenario === 'reviewing-6-of-8' ||
    scenario === 'just-unlocked' ||
    scenario === 'missed-deadline';

  return {
    id: 'pool-maverick-xlt',
    slug: 'ford-maverick-xlt-portland',
    title: '2026 Ford Maverick XLT Hybrid AWD',
    subtitle: 'Standard XLT package, zero dealer add-ons, single-lot Portland pickup',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro pickup',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 8,
    maxQuantity: 8,
    goalDate: '2026-12-14',
    stage: stageByScenario[scenario],
    imageUrl: STITCH_MAVERICK_IMAGE_URL,
    imageAlt:
      '2026 Ford Maverick XLT compact pickup truck parked on a Pacific Northwest neighborhood street in warm daylight',
    organizerId: PERSONAS.organizer.id,
    organizerName: PERSONAS.organizer.name,
    organizerNote:
      'Keeping this group strictly to XLT Hybrid AWD with no dealer-installed accessories so one local fleet desk can quote a clean, uniform out-the-door baseline.',
    sharedRequirements: [
      '2026 Ford Maverick XLT Hybrid AWD (2.5L Hybrid)',
      'No mandatory dealer protection packages or VIN etching',
      'Local pickup within Portland metro before Dec 20',
      'Direct buyer-to-seller purchase once minimum of 8 confirms',
    ],
    categorySpecs: [
      { label: 'Vehicle type', value: 'Pickup truck' },
      { label: 'Model', value: 'Ford Maverick (2026)' },
      { label: 'Trim', value: 'XLT Hybrid AWD' },
      { label: 'Target pickup', value: 'Portland metro · by Dec 20' },
      { label: 'Required group size', value: '8 vehicles (cap 8)' },
    ],
    vehicleSpecs: {
      assetClass: 'vehicle',
      vehicleType: 'pickup',
      condition: 'new',
      make: 'Ford',
      model: 'Maverick',
      year: 2026,
      trim: 'XLT',
      powertrain: 'Hybrid',
      drivetrain: 'AWD',
      requiredFields: ['vehicleType', 'condition', 'make', 'model', 'year', 'trim', 'powertrain', 'drivetrain'],
    },
    optionGroups: [
      {
        id: 'trim',
        label: 'Trim & powertrain',
        required: true,
        allowedValues: ['XLT Hybrid AWD'],
        allValues: ['XLT Hybrid AWD', 'Lariat EcoBoost (Excluded)'],
      },
      {
        id: 'color',
        label: 'Exterior color preference',
        required: false,
        allowedValues: ['Cactus Gray', 'Oxford White', 'Carbonized Gray', 'Hot Pepper Red'],
        allValues: ['Cactus Gray', 'Oxford White', 'Carbonized Gray', 'Hot Pepper Red'],
      },
      {
        id: 'delivery',
        label: 'Pickup / delivery',
        required: true,
        allowedValues: ['Portland metro pickup'],
        allValues: ['Portland metro pickup', 'Out-of-state shipping'],
      },
    ],
    sellerToken: hasOffer ? 'alder-maverick-req-2026' : undefined,
    quoteRequestedAt: hasOffer ? '2026-12-08T16:30:00.000Z' : undefined,
    currentOffer: hasOffer ? offer : undefined,
    offerHistory: [],
    members,
    discussion: [
      {
        id: 'disc-1',
        authorId: PERSONAS.organizer.id,
        authorName: PERSONAS.organizer.name,
        authorRole: 'organizer',
        body: 'Update: Confirmed with three Portland-area fleet desks that 8 uniform XLT Hybrid AWD orders is the threshold for flat fleet pricing with zero dealer add-ons.',
        createdAt: '2026-12-06T20:15:00.000Z',
        isOrganizerUpdate: true,
      },
      {
        id: 'disc-2',
        authorId: 'member-priya',
        authorName: 'Priya N.',
        authorRole: 'buyer',
        body: 'Does Oregon privilege tax stay separate from the quoted subtotal? Good to see it itemized cleanly.',
        createdAt: '2026-12-07T18:30:00.000Z',
      },
      {
        id: 'disc-3',
        authorId: PERSONAS.organizer.id,
        authorName: PERSONAS.organizer.name,
        authorRole: 'organizer',
        body: 'Yes — every seller quote on Tally separates vehicle price and documentation fees from state tax and DMV registration so Washington and Oregon buyers can verify exact numbers.',
        createdAt: '2026-12-07T19:05:00.000Z',
        isOrganizerUpdate: true,
      },
    ],
    followers: [],
    createdAt: '2026-12-01T18:00:00.000Z',
    updatedAt: '2026-12-08T17:00:00.000Z',
  };
}

function buildOtherDirectoryPools(): Pool[] {
  // 2. Ready-to-claim / Unlocked payoff card (Furniture)
  const walnutTablePool: Pool = {
    id: 'pool-walnut-dining',
    slug: 'solid-walnut-dining-table-portland',
    title: 'Solid Walnut 8-Seat Dining Table',
    subtitle: 'Westside Woodworks · 90" × 40" kiln-dried black walnut, matte oil finish',
    category: 'Furniture',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro white-glove delivery',
    unitSingular: 'furniture unit',
    unitPlural: 'furniture units',
    minQuantity: 6,
    maxQuantity: 6,
    goalDate: '2026-12-10',
    stage: 'unlocked',
    imageUrl: GENERATED_IMAGES.walnutTable,
    imageAlt: 'Handcrafted solid American black walnut 8-seat dining table in a sunlit Portland dining room',
    organizerId: 'org-claire',
    organizerName: 'Claire Halvorsen',
    organizerNote:
      'All 6 tables are milled from one lumber batch so Westside Woodworks cut $380 off retail per table and waived crate fees.',
    sharedRequirements: [
      'SKU WW-DT90: 90" × 40" solid black walnut top, trestle base',
      'Natural matte hardwax oil finish',
      'Curbside or white-glove delivery inside Portland metro',
    ],
    categorySpecs: [
      { label: 'SKU', value: 'WW-DT90 (90" × 40")' },
      { label: 'Finish', value: 'Natural Matte Oil' },
      { label: 'Delivery', value: 'Portland metro ($85 flat)' },
      { label: 'Unlocked price', value: '$1,505 subtotal ($380 off retail)' },
    ],
    optionGroups: [
      {
        id: 'finish',
        label: 'Wood finish',
        required: true,
        allowedValues: ['Natural Matte Oil'],
        allValues: ['Natural Matte Oil', 'Custom Ebonized Stain (Excluded)'],
      },
      {
        id: 'delivery',
        label: 'Delivery zone',
        required: true,
        allowedValues: ['Portland metro delivery'],
        allValues: ['Portland metro delivery', 'Freight outside OR/WA'],
      },
    ],
    sellerToken: 'westside-walnut-2026',
    quoteRequestedAt: '2026-12-03T18:00:00.000Z',
    currentOffer: {
      version: 1,
      sellerName: 'Westside Woodworks Co. (Fictional)',
      sellerLocation: 'Portland, OR',
      matchingScope: '6× WW-DT90 Solid Walnut Dining Tables · Single batch mill run',
      currency: 'USD',
      unitPrice: 1420,
      knownFees: 85,
      feeLabel: 'Local white-glove delivery',
      subtotal: 1505,
      taxAndRegistrationNote: 'No Oregon sales tax. Assembly included on delivery.',
      minQuantity: 6,
      maxQuantity: 6,
      fulfillmentMethod: 'Direct studio invoice & delivery scheduling with Westside Woodworks',
      closeAt: '2026-12-12T02:00:00.000Z',
      timezoneLabel: 'Pacific',
      claimByDate: '2026-12-18',
      publishedAt: '2026-12-04T19:00:00.000Z',
      privateClaimInstructions:
        'SIMULATED DEMO INSTRUCTIONS: Email your claim code to Westside Woodworks Workshop Desk by Dec 18 to schedule your January delivery slot and pay the studio directly. No payment is processed on Tally.',
      privateReferencePrefix: 'WW-DT90-PDX',
    },
    offerHistory: [],
    members: [
      {
        id: 'wf-1',
        userId: PERSONAS.buyer.id,
        displayName: PERSONAS.buyer.name,
        location: 'Portland metro',
        quantity: 1,
        selectedOptions: { finish: 'Natural Matte Oil', delivery: 'Portland metro delivery' },
        joinedAt: '2026-12-01T17:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-05T18:00:00.000Z',
        privateEmail: PERSONAS.buyer.email,
        privatePhone: PERSONAS.buyer.phone,
      },
      {
        id: 'wf-2',
        userId: 'org-claire',
        displayName: 'Claire Halvorsen',
        location: 'NW Portland',
        quantity: 1,
        selectedOptions: { finish: 'Natural Matte Oil', delivery: 'Portland metro delivery' },
        joinedAt: '2026-12-01T16:00:00.000Z',
        status: 'fulfilled',
        confirmedVersion: 1,
        confirmedAt: '2026-12-04T20:00:00.000Z',
        fulfilledAt: '2026-12-07T19:00:00.000Z',
      },
      {
        id: 'wf-3',
        userId: 'mem-w3',
        displayName: 'Nadia S.',
        location: 'SE Portland',
        quantity: 2,
        selectedOptions: { finish: 'Natural Matte Oil', delivery: 'Portland metro delivery' },
        joinedAt: '2026-12-02T14:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-05T16:00:00.000Z',
      },
      {
        id: 'wf-4',
        userId: 'mem-w4',
        displayName: 'Gabe T.',
        location: 'Beaverton',
        quantity: 2,
        selectedOptions: { finish: 'Natural Matte Oil', delivery: 'Portland metro delivery' },
        joinedAt: '2026-12-03T15:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-06T17:00:00.000Z',
      },
    ],
    discussion: [
      {
        id: 'wd-1',
        authorId: 'org-claire',
        authorName: 'Claire Halvorsen',
        authorRole: 'organizer',
        body: 'All 6 units confirmed! Claim codes are active in the Claim tab until Dec 18.',
        createdAt: '2026-12-06T18:00:00.000Z',
        isOrganizerUpdate: true,
      },
    ],
    followers: [],
    createdAt: '2026-12-01T15:00:00.000Z',
    updatedAt: '2026-12-06T18:00:00.000Z',
  };

  // 3. Apartments — Gathering
  const burnsidePool: Pool = {
    id: 'pool-burnside-apts',
    slug: 'east-burnside-lofts-1br-group',
    title: 'East Burnside Lofts — 1BR 12-Month Lease Group',
    subtitle: 'Coordinated Jan 15 move-in cohort negotiating waived admin fee + 6 weeks free',
    category: 'Apartments',
    location: 'Portland metro',
    deliveryOrDestination: 'Central Eastside, Portland',
    unitSingular: 'household',
    unitPlural: 'households',
    minQuantity: 5,
    maxQuantity: 7,
    goalDate: '2026-12-18',
    stage: 'gathering',
    imageUrl: GENERATED_IMAGES.burnsideLofts,
    imageAlt: 'Modern brick and cedar mid-rise apartment building in Portland surrounded by courtyard greenery',
    organizerId: 'org-marcus',
    organizerName: 'Marcus Bell',
    organizerNote:
      'Leasing office indicated a group of 5+ households signing Jan 15 leases unlocks their corporate relocation concession (6 weeks free + $0 application/admin fee).',
    sharedRequirements: [
      '1-Bedroom floorplans (680–740 sq ft)',
      '12-month lease term starting Jan 15–Feb 1, 2027',
      'Standard income/credit screening completed directly with property',
    ],
    categorySpecs: [
      { label: 'Unit size', value: '1 Bedroom (680–740 sq ft)' },
      { label: 'Move-in window', value: 'Jan 15 – Feb 1, 2027' },
      { label: 'Lease term', value: '12 months' },
      { label: 'Target group', value: '5 households' },
    ],
    optionGroups: [
      {
        id: 'unitSize',
        label: 'Unit size',
        required: true,
        allowedValues: ['1 Bedroom'],
        allValues: ['1 Bedroom', '2 Bedroom (Excluded)'],
      },
      {
        id: 'moveIn',
        label: 'Move-in date',
        required: true,
        allowedValues: ['Jan 15, 2027', 'Feb 1, 2027'],
        allValues: ['Jan 15, 2027', 'Feb 1, 2027', 'April 2027 (Excluded)'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'apt-1',
        userId: 'org-marcus',
        displayName: 'Marcus Bell',
        location: 'Portland',
        quantity: 1,
        selectedOptions: { unitSize: '1 Bedroom', moveIn: 'Jan 15, 2027' },
        joinedAt: '2026-12-03T19:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'apt-2',
        userId: 'mem-a2',
        displayName: 'Jules D.',
        location: 'Portland',
        quantity: 1,
        selectedOptions: { unitSize: '1 Bedroom', moveIn: 'Jan 15, 2027' },
        joinedAt: '2026-12-04T19:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'apt-3',
        userId: 'mem-a3',
        displayName: 'Kira W.',
        location: 'Seattle -> Portland',
        quantity: 1,
        selectedOptions: { unitSize: '1 Bedroom', moveIn: 'Feb 1, 2027' },
        joinedAt: '2026-12-05T19:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'apt-4',
        userId: 'mem-a4',
        displayName: 'Owen P.',
        location: 'Portland',
        quantity: 1,
        selectedOptions: { unitSize: '1 Bedroom', moveIn: 'Feb 1, 2027' },
        joinedAt: '2026-12-07T19:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [
      {
        id: 'ad-1',
        authorId: 'org-marcus',
        authorName: 'Marcus Bell',
        authorRole: 'organizer',
        body: 'Just need one more 1BR household to hit 5 and submit the written concession request.',
        createdAt: '2026-12-07T20:00:00.000Z',
        isOrganizerUpdate: true,
      },
    ],
    followers: [],
    createdAt: '2026-12-03T18:00:00.000Z',
    updatedAt: '2026-12-07T20:00:00.000Z',
  };

  // 4. Hotels — Offer Open
  const hotelPool: Pool = {
    id: 'pool-hood-hotel',
    slug: 'gorge-winter-ski-lodge-block',
    title: 'Timberline Ridge Lodge — MLK Ski Weekend Block',
    subtitle: 'Jan 16–18 (2 nights) · King & Double Queen rooms with breakfast',
    category: 'Hotels',
    location: 'Hood River / Gorge',
    deliveryOrDestination: 'Mt. Hood / Hood River, OR',
    unitSingular: 'room',
    unitPlural: 'rooms',
    minQuantity: 10,
    maxQuantity: 12,
    goalDate: '2026-12-15',
    stage: 'offer_open',
    imageUrl: GENERATED_IMAGES.hoodLodge,
    imageAlt: 'Warm Pacific Northwest timber mountain lodge guest room looking out onto pine trees and snow',
    organizerId: 'org-devon',
    organizerName: PERSONAS.organizer.name,
    organizerNote:
      'Small group room-block rate secured from Timberline Ridge Lodge (fictional). Each room books directly once 10 rooms confirm.',
    sharedRequirements: [
      'Check-in Jan 16, 2027 · Check-out Jan 18, 2027 (2 nights)',
      'Standard King or Double Queen forest-view room',
      'Free cancellation up to 7 days prior per lodge terms',
    ],
    categorySpecs: [
      { label: 'Destination', value: 'Hood River / Mt. Hood, OR' },
      { label: 'Check-in / Check-out', value: 'Jan 16 – Jan 18, 2027' },
      { label: 'Rooms required', value: '10 rooms (cap 12)' },
      { label: 'Quoted nightly', value: '$189/night + $18 resort fee' },
    ],
    optionGroups: [
      {
        id: 'roomType',
        label: 'Room type',
        required: true,
        allowedValues: ['Standard King', 'Double Queen'],
        allValues: ['Standard King', 'Double Queen', 'Penthouse Suite (Excluded)'],
      },
    ],
    sellerToken: 'timberline-lodge-2026',
    quoteRequestedAt: '2026-12-05T17:00:00.000Z',
    currentOffer: {
      version: 1,
      sellerName: 'Timberline Ridge Hospitality (Fictional)',
      sellerLocation: 'Hood River, OR',
      matchingScope: '10–12 rooms · Jan 16–18, 2027 (2-night stay, price shown per night)',
      currency: 'USD',
      unitPrice: 189,
      knownFees: 18,
      feeLabel: 'Nightly lodge & parking fee',
      subtotal: 207,
      taxAndRegistrationNote: 'Excludes 10.5% local lodging tax. Billed per room at check-in.',
      minQuantity: 10,
      maxQuantity: 12,
      fulfillmentMethod: 'Direct room reservation link via Lodge Group Desk',
      closeAt: '2026-12-17T02:00:00.000Z',
      timezoneLabel: 'Pacific',
      claimByDate: '2026-12-22',
      publishedAt: '2026-12-06T21:00:00.000Z',
      privateClaimInstructions:
        'SIMULATED DEMO INSTRUCTIONS: Call Timberline Ridge Group Desk with block code before Dec 22 to attach your individual room reservation.',
      privateReferencePrefix: 'TRL-MLK-2027',
    },
    offerHistory: [],
    members: [
      {
        id: 'ht-1',
        userId: 'org-devon',
        displayName: 'Devon Brooks (Organizer)',
        location: 'Portland',
        quantity: 2,
        selectedOptions: { roomType: 'Double Queen' },
        joinedAt: '2026-12-02T18:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-07T18:00:00.000Z',
      },
      {
        id: 'ht-2',
        userId: 'mem-h2',
        displayName: 'Avery L.',
        location: 'Portland',
        quantity: 3,
        selectedOptions: { roomType: 'Standard King' },
        joinedAt: '2026-12-03T18:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-07T19:00:00.000Z',
      },
      {
        id: 'ht-3',
        userId: 'mem-h3',
        displayName: 'Benji C.',
        location: 'Hood River',
        quantity: 2,
        selectedOptions: { roomType: 'Double Queen' },
        joinedAt: '2026-12-04T18:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-07T20:00:00.000Z',
      },
      {
        id: 'ht-4',
        userId: 'mem-h4',
        displayName: 'Sora K.',
        location: 'Seattle',
        quantity: 3,
        selectedOptions: { roomType: 'Standard King' },
        joinedAt: '2026-12-05T18:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-02T17:00:00.000Z',
    updatedAt: '2026-12-07T20:00:00.000Z',
  };

  // 5. Collectibles — Gathering (no photo, clean typographic card)
  const vinylPool: Pool = {
    id: 'pool-vinyl-box',
    slug: 'pnw-jazz-archival-4lp-box',
    title: 'Pacific Northwest Jazz Archival 4LP Box Set',
    subtitle: '180g audiophile pressing · Numbered linen slipcase · Distributor carton buy',
    category: 'Collectibles',
    location: 'Ships nationwide',
    deliveryOrDestination: 'USPS Media Mail or Portland shop pickup',
    unitSingular: 'copy',
    unitPlural: 'copies',
    minQuantity: 20,
    maxQuantity: 25,
    goalDate: '2026-12-20',
    stage: 'gathering',
    organizerId: 'org-ren',
    organizerName: 'Ren Takahashi',
    organizerNote:
      'Independent record distributor requires a 20-copy master carton order to unlock wholesale pricing (~$94 vs $135 retail).',
    sharedRequirements: [
      '2026 First Pressing, 180g virgin vinyl, sealed Mint (M)',
      'Includes 36-page archival photo booklet',
      'Direct invoice from Burnside Wax Co. (fictional distributor)',
    ],
    categorySpecs: [
      { label: 'Edition', value: 'First Pressing · Numbered 4LP' },
      { label: 'Condition', value: 'Sealed Mint (M)' },
      { label: 'Fulfillment', value: 'Ships nationwide / PDX pickup' },
      { label: 'Minimum order', value: '20 copies' },
    ],
    optionGroups: [
      {
        id: 'edition',
        label: 'Edition',
        required: true,
        allowedValues: ['Numbered Standard 4LP'],
        allValues: ['Numbered Standard 4LP', 'Test Pressing (Excluded)'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'vn-1',
        userId: 'org-ren',
        displayName: 'Ren Takahashi',
        location: 'Portland',
        quantity: 6,
        selectedOptions: { edition: 'Numbered Standard 4LP' },
        joinedAt: '2026-12-02T15:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'vn-2',
        userId: 'mem-v2',
        displayName: 'Daria M.',
        location: 'Seattle',
        quantity: 4,
        selectedOptions: { edition: 'Numbered Standard 4LP' },
        joinedAt: '2026-12-04T15:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'vn-3',
        userId: 'mem-v3',
        displayName: 'Theo B.',
        location: 'Eugene',
        quantity: 4,
        selectedOptions: { edition: 'Numbered Standard 4LP' },
        joinedAt: '2026-12-06T15:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-02T14:00:00.000Z',
    updatedAt: '2026-12-06T15:00:00.000Z',
  };

  // 6. Other — Past Outcome / Closed
  const heatPumpPool: Pool = {
    id: 'pool-heatpump-pdx',
    slug: 'ductless-heat-pump-eastside-install',
    title: 'Ductless Mini-Split Heat Pump Group Install',
    subtitle: 'Completed November cohort · 12 Eastside homes · 18k BTU cold-climate units',
    category: 'Other',
    location: 'Portland metro',
    deliveryOrDestination: 'Eastside Portland installation',
    unitSingular: 'home',
    unitPlural: 'homes',
    minQuantity: 10,
    maxQuantity: 12,
    goalDate: '2026-11-18',
    stage: 'closed',
    organizerId: 'org-devon',
    organizerName: PERSONAS.organizer.name,
    organizerNote:
      'Completed cohort. Contractor batched permits and truck rolls across 12 adjacent homes, saving ~$1,150 per household.',
    sharedRequirements: [
      '18,000 BTU cold-climate inverter mini-split',
      'Standard exterior wall mount within 25ft line set',
      'Licensed HVAC installation & city permit included',
    ],
    categorySpecs: [
      { label: 'Unit label', value: 'home / homes' },
      { label: 'Final unlocked price', value: '$4,280 installed (saved ~$1,150)' },
      { label: 'Outcome', value: '12 of 10 homes fulfilled · Nov 2026' },
    ],
    optionGroups: [
      {
        id: 'mount',
        label: 'Mount style',
        required: true,
        allowedValues: ['Standard wall mount'],
        allValues: ['Standard wall mount'],
      },
    ],
    currentOffer: {
      version: 1,
      sellerName: 'Willamette Comfort Mechanical (Fictional)',
      sellerLocation: 'Portland, OR',
      matchingScope: '12× 18k BTU cold-climate mini-split installations',
      currency: 'USD',
      unitPrice: 4100,
      knownFees: 180,
      feeLabel: 'City mechanical permit & inspection',
      subtotal: 4280,
      taxAndRegistrationNote: 'Eligible for local utility rebate after direct contractor invoice.',
      minQuantity: 10,
      maxQuantity: 12,
      fulfillmentMethod: 'Direct contractor scheduling by street block',
      closeAt: '2026-11-18T02:00:00.000Z',
      timezoneLabel: 'Pacific',
      claimByDate: '2026-11-30',
      publishedAt: '2026-11-12T18:00:00.000Z',
      privateClaimInstructions: 'Cohort completed.',
      privateReferencePrefix: 'WCM-HP-2026',
    },
    offerHistory: [],
    members: [
      {
        id: 'hp-1',
        userId: 'org-devon',
        displayName: 'Devon Brooks',
        location: 'Portland',
        quantity: 12,
        selectedOptions: { mount: 'Standard wall mount' },
        joinedAt: '2026-11-01T18:00:00.000Z',
        status: 'fulfilled',
        confirmedVersion: 1,
        confirmedAt: '2026-11-15T18:00:00.000Z',
        fulfilledAt: '2026-11-28T18:00:00.000Z',
      },
    ],
    discussion: [],
    followers: [],
    outcomeSummary: '12 of 10 homes fulfilled at $4,280 installed (~$1,150 under individual quotes).',
    createdAt: '2026-11-01T17:00:00.000Z',
    updatedAt: '2026-11-28T18:00:00.000Z',
  };

  // 7. Vehicles (Accessory — NOT a motor vehicle) — Seattle metro
  const evChargerPool: Pool = {
    id: 'pool-ev-charger-sea',
    slug: 'level-2-ev-charger-48a-seattle',
    title: '48A Hardwired Level 2 Home EV Charger Bulk Buy',
    subtitle: 'UL-listed NACS/J1772 smart wallboxes · Vehicle accessory (not a motor vehicle)',
    category: 'Vehicles',
    location: 'Seattle metro',
    deliveryOrDestination: 'Seattle metro pickup',
    unitSingular: 'charger',
    unitPlural: 'chargers',
    minQuantity: 10,
    maxQuantity: 15,
    goalDate: '2026-12-21',
    stage: 'gathering',
    organizerId: 'org-soren',
    organizerName: 'Soren Lindqvist',
    organizerNote: 'Pooling 10+ units directly with a regional electrical supply house for contractor tier pricing.',
    sharedRequirements: [
      '48A hardwired NEMA 4 outdoor-rated unit',
      '25ft cable with NACS connector',
      'Local Seattle pickup or courier drop',
    ],
    categorySpecs: [
      { label: 'Classification', value: 'Vehicle accessory / charging equipment (not a motor vehicle)' },
      { label: 'Model', value: '48A Hardwired Smart Wallbox' },
      { label: 'Connector', value: 'NACS (25ft cord)' },
      { label: 'Minimum', value: '10 chargers' },
    ],
    vehicleSpecs: {
      assetClass: 'accessory',
    },
    optionGroups: [
      {
        id: 'connector',
        label: 'Connector type',
        required: true,
        allowedValues: ['NACS', 'J1772'],
        allValues: ['NACS', 'J1772'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'ev-1',
        userId: 'org-soren',
        displayName: 'Soren Lindqvist',
        location: 'Ballard, Seattle',
        quantity: 3,
        selectedOptions: { connector: 'NACS' },
        joinedAt: '2026-12-03T18:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'ev-2',
        userId: 'mem-ev2',
        displayName: 'Mina J.',
        location: 'Bellevue',
        quantity: 2,
        selectedOptions: { connector: 'NACS' },
        joinedAt: '2026-12-05T18:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-03T17:00:00.000Z',
    updatedAt: '2026-12-05T18:00:00.000Z',
  };

  // 8. Passenger Car / SUV — Tally Certified bulk deal (fictional demo example)
  const subaruOutbackPool: Pool = {
    id: 'pool-subaru-outback-cert',
    slug: 'subaru-outback-touring-xt-portland',
    title: '2026 Subaru Outback Touring XT AWD',
    subtitle: 'Tally-coordinated Portland dealer bulk pool · New Touring XT turbo AWD wagons',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland metro dealership delivery',
    unitSingular: 'vehicle',
    unitPlural: 'vehicles',
    minQuantity: 6,
    maxQuantity: 10,
    goalDate: '2026-12-22',
    stage: 'gathering',
    organizerId: 'org-devon',
    organizerName: PERSONAS.organizer.name,
    organizerNote:
      'Fictional demo example of a Tally Certified bulk deal coordinated with Cascade Valley Motors (fictional) for 6–10 Touring XT AWD units.',
    sharedRequirements: [
      'New 2026 Subaru Outback Touring XT AWD (2.4L Turbo Gas)',
      'Zero mandatory dealer add-ons or paint sealant packages',
      'Direct buyer-to-dealer purchase in Portland metro by Dec 30',
    ],
    categorySpecs: [
      { label: 'Vehicle type', value: 'Passenger car / SUV' },
      { label: 'Condition', value: 'New' },
      { label: 'Model', value: '2026 Subaru Outback' },
      { label: 'Trim', value: 'Touring XT' },
      { label: 'Powertrain & drive', value: 'Gas · AWD · CVT Automatic' },
    ],
    vehicleSpecs: {
      assetClass: 'vehicle',
      vehicleType: 'passenger',
      condition: 'new',
      make: 'Subaru',
      model: 'Outback',
      year: 2026,
      trim: 'Touring XT',
      powertrain: 'Gas',
      transmission: 'CVT Automatic',
      drivetrain: 'AWD',
      requiredFields: ['vehicleType', 'condition', 'make', 'model', 'year', 'trim', 'drivetrain'],
    },
    tallyCertification: buildTrustedTallyCertification(
      'tally_seed',
      'Cascade Valley Motors (Fictional Demo Dealer)',
      'Tally organized this fictional demo bulk pool directly with Cascade Valley Motors for qualifying 2026 Outback Touring XT buyers.'
    ),
    optionGroups: [
      {
        id: 'trim',
        label: 'Trim & drivetrain',
        required: true,
        allowedValues: ['Touring XT AWD'],
        allValues: ['Touring XT AWD', 'Base AWD (Excluded)'],
      },
      {
        id: 'color',
        label: 'Exterior color preference',
        required: false,
        allowedValues: ['Autumn Green', 'Ice Silver', 'Crystal White'],
        allValues: ['Autumn Green', 'Ice Silver', 'Crystal White'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'sub-1',
        userId: 'org-devon',
        displayName: 'Devon Brooks (Organizer)',
        location: 'Portland metro',
        quantity: 2,
        selectedOptions: { trim: 'Touring XT AWD', color: 'Autumn Green' },
        joinedAt: '2026-12-03T18:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'sub-2',
        userId: 'mem-sub-2',
        displayName: 'Rachel P.',
        location: 'Beaverton',
        quantity: 2,
        selectedOptions: { trim: 'Touring XT AWD', color: 'Crystal White' },
        joinedAt: '2026-12-05T18:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'sub-3',
        userId: 'mem-sub-3',
        displayName: 'Kenji T.',
        location: 'Lake Oswego',
        quantity: 1,
        selectedOptions: { trim: 'Touring XT AWD', color: 'Ice Silver' },
        joinedAt: '2026-12-06T18:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-03T17:00:00.000Z',
    updatedAt: '2026-12-06T18:00:00.000Z',
  };

  // 9. Commercial Van / Truck — Paid Featured placement (fictional demo example)
  const isuzuBoxTruckPool: Pool = {
    id: 'pool-isuzu-box-truck-paid',
    slug: 'isuzu-npr-hd-16ft-box-truck-portland',
    title: '2026 Isuzu NPR-HD 16ft Dry Freight Box Truck',
    subtitle: 'Commercial fleet group buy · 14,500 lbs GVWR · 4x2 diesel · Roll-up rear door',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland commercial upfit yard pickup',
    unitSingular: 'truck',
    unitPlural: 'trucks',
    minQuantity: 5,
    maxQuantity: 8,
    goalDate: '2026-12-23',
    stage: 'gathering',
    organizerId: 'org-fleet-nora',
    organizerName: 'Nora Lind (PDX Local Freight)',
    organizerNote:
      'Small local distributors pooling 5 identical 16ft dry-van box trucks to negotiate commercial fleet pricing and synchronized upfit delivery.',
    sharedRequirements: [
      'New 2026 Isuzu NPR-HD Diesel (4x2 single rear axle, dual rear wheels)',
      '16ft aluminum dry freight box body with 2,500 lb tuck-under liftgate',
      'Minimum 14,500 lbs GVWR / 8,300 lbs payload rating (buyer to verify OEM body-builder sheet)',
    ],
    categorySpecs: [
      { label: 'Vehicle type', value: 'Commercial van / truck' },
      { label: 'Condition', value: 'New' },
      { label: 'Model', value: '2026 Isuzu NPR-HD' },
      { label: 'Body / config', value: '16ft Dry Freight Box Truck w/ liftgate' },
      { label: 'Axle config', value: '4x2' },
      { label: 'GVWR', value: '14,500 lbs' },
      { label: 'Payload', value: '8,300 lbs' },
    ],
    vehicleSpecs: {
      assetClass: 'vehicle',
      vehicleType: 'commercial_van_truck',
      condition: 'new',
      make: 'Isuzu',
      model: 'NPR-HD',
      year: 2026,
      trim: 'Commercial Fleet',
      powertrain: 'Diesel',
      transmission: '6-Speed Automatic',
      drivetrain: 'RWD',
      bodyConfiguration: '16ft Box Truck (dry freight + liftgate)',
      axleConfiguration: '4x2',
      gvwr: { value: 14500, unit: 'lbs' },
      payloadCapacity: { value: 8300, unit: 'lbs' },
      deliveryOrFleetNotes: 'Upfit completion required prior to lot handover; commercial registration by buyer.',
      requiredFields: [
        'vehicleType',
        'condition',
        'make',
        'model',
        'year',
        'powertrain',
        'bodyConfiguration',
        'axleConfiguration',
        'gvwr',
      ],
    },
    paidPlacement: buildTrustedPaidPlacement(
      'tally_seed',
      'Pacific Fleet Commercial Group (Fictional Demo Sponsor)'
    ),
    optionGroups: [
      {
        id: 'bodyConfig',
        label: 'Body & axle configuration',
        required: true,
        allowedValues: ['16ft Box Truck · 4x2 Diesel'],
        allValues: ['16ft Box Truck · 4x2 Diesel', '14ft Flatbed (Excluded)'],
      },
      {
        id: 'delivery',
        label: 'Handover location',
        required: true,
        allowedValues: ['Portland commercial yard pickup'],
        allValues: ['Portland commercial yard pickup', 'Out-of-state freight'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'isz-1',
        userId: 'org-fleet-nora',
        displayName: 'Nora Lind (Organizer)',
        location: 'Swan Island, Portland',
        quantity: 2,
        selectedOptions: {
          bodyConfig: '16ft Box Truck · 4x2 Diesel',
          delivery: 'Portland commercial yard pickup',
        },
        joinedAt: '2026-12-04T18:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'isz-2',
        userId: 'mem-isz-2',
        displayName: 'River City Roasters Fleet',
        location: 'SE Portland',
        quantity: 2,
        selectedOptions: {
          bodyConfig: '16ft Box Truck · 4x2 Diesel',
          delivery: 'Portland commercial yard pickup',
        },
        joinedAt: '2026-12-06T18:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-04T17:00:00.000Z',
    updatedAt: '2026-12-06T18:00:00.000Z',
  };

  // 10. Bus — Ordinary organic commercial pool (fictional demo example)
  const shuttleBusPool: Pool = {
    id: 'pool-shuttle-bus-ada',
    slug: 'blue-bird-micro-bird-24p-ada-shuttle-bus',
    title: '2026 Blue Bird Micro Bird 24-Passenger ADA Shuttle Bus',
    subtitle: '24 passengers + 2 wheelchair positions · Rear ADA lift · Regional shuttle operators',
    category: 'Vehicles',
    location: 'Seattle metro',
    deliveryOrDestination: 'Seattle / Tacoma fleet depot delivery',
    unitSingular: 'bus',
    unitPlural: 'buses',
    minQuantity: 5,
    maxQuantity: 8,
    goalDate: '2026-12-26',
    stage: 'gathering',
    organizerId: 'org-bus-mateo',
    organizerName: 'Mateo Alvarez (Sound Community Transit)',
    organizerNote:
      'Independent regional shuttle and senior-care operators pooling 5 matching ADA-equipped 24-passenger shuttle buses for one upfitter build slot.',
    sharedRequirements: [
      'New 2026 Blue Bird Micro Bird Shuttle Bus (Gas or Propane)',
      '24-passenger high-back seating + ADA rear wheelchair lift with 2 tie-down stations',
      'Buyer responsible for local transit inspection and state commercial licensing',
    ],
    categorySpecs: [
      { label: 'Vehicle type', value: 'Bus' },
      { label: 'Condition', value: 'New' },
      { label: 'Model', value: '2026 Blue Bird Micro Bird' },
      { label: 'Bus type', value: 'Shuttle bus' },
      { label: 'Seating capacity', value: '24 passengers' },
      { label: 'Accessibility', value: 'ADA wheelchair lift (2 tie-downs)' },
      { label: 'GVWR', value: '14,500 lbs' },
    ],
    vehicleSpecs: {
      assetClass: 'vehicle',
      vehicleType: 'bus',
      condition: 'new',
      make: 'Blue Bird',
      model: 'Micro Bird',
      year: 2026,
      powertrain: 'Gas',
      transmission: 'Automatic',
      drivetrain: 'RWD',
      axleConfiguration: '4x2',
      gvwr: { value: 14500, unit: 'lbs' },
      busType: 'Shuttle bus',
      seatingCapacity: 24,
      accessibilityRequirement: 'ADA wheelchair lift (2 tie-downs)',
      deliveryOrFleetNotes: 'Factory shuttle delivery to Seattle/Tacoma depot; fleet graphics excluded.',
      requiredFields: ['vehicleType', 'condition', 'busType', 'seatingCapacity', 'accessibilityRequirement'],
    },
    optionGroups: [
      {
        id: 'busConfig',
        label: 'Seating & accessibility',
        required: true,
        allowedValues: ['24-Passenger · ADA Wheelchair Lift'],
        allValues: ['24-Passenger · ADA Wheelchair Lift', '14-Passenger Non-ADA (Excluded)'],
      },
    ],
    offerHistory: [],
    members: [
      {
        id: 'bus-1',
        userId: 'org-bus-mateo',
        displayName: 'Mateo Alvarez (Organizer)',
        location: 'Tacoma, WA',
        quantity: 2,
        selectedOptions: { busConfig: '24-Passenger · ADA Wheelchair Lift' },
        joinedAt: '2026-12-03T18:00:00.000Z',
        status: 'interested',
      },
      {
        id: 'bus-2',
        userId: 'mem-bus-2',
        displayName: 'Evergreen Senior Rides',
        location: 'Bellevue, WA',
        quantity: 1,
        selectedOptions: { busConfig: '24-Passenger · ADA Wheelchair Lift' },
        joinedAt: '2026-12-05T18:00:00.000Z',
        status: 'interested',
      },
    ],
    discussion: [],
    followers: [],
    createdAt: '2026-12-03T17:00:00.000Z',
    updatedAt: '2026-12-05T18:00:00.000Z',
  };

  // 11. Semi-Tractor / 18-Wheeler — BOTH Paid Featured + Tally Certified + Published Commercial Quote
  const cascadiaSemiPool: Pool = {
    id: 'pool-cascadia-semi',
    slug: 'freightliner-cascadia-126-sleeper-semi-tractor',
    title: '2026 Freightliner Cascadia 126 Sleeper Semi-Tractor (6x4)',
    subtitle: 'Tractor unit only (trailer NOT included) · 72" raised roof sleeper · 80,000 lbs GCWR · Published quote v1',
    category: 'Vehicles',
    location: 'Portland metro',
    deliveryOrDestination: 'Portland commercial truck center pickup',
    unitSingular: 'tractor',
    unitPlural: 'tractors',
    minQuantity: 5,
    maxQuantity: 8,
    goalDate: '2026-12-19',
    stage: 'offer_open',
    organizerId: 'org-devon',
    organizerName: PERSONAS.organizer.name,
    organizerNote:
      'Fictional demo example of a dual-badged (Sponsored · Featured + Tally Certified) Class-8 semi-tractor bulk pool. Tractor units only — semi-trailers are explicitly excluded unless separately contracted.',
    sharedRequirements: [
      'New 2026 Freightliner Cascadia 126 72" Raised Roof Sleeper tractor unit',
      '6x4 tandem drive axle · Diesel · DT12 Automated Manual Transmission (AMT)',
      'Tractor unit only — semi-trailer NOT included in quoted price',
      'Minimum 80,000 lbs GCWR spec (buyer verifies OEM axle/bridge compliance independently)',
    ],
    categorySpecs: [
      { label: 'Vehicle type', value: 'Semi-tractor' },
      { label: 'Condition', value: 'New' },
      { label: 'Model', value: '2026 Freightliner Cascadia 126' },
      { label: 'Axle config', value: '6x4' },
      { label: 'Cab / sleeper', value: '72" Raised Roof Sleeper' },
      { label: 'GCWR', value: '80,000 lbs' },
      { label: 'Trailer', value: 'Tractor unit only — trailer NOT included' },
    ],
    vehicleSpecs: {
      assetClass: 'vehicle',
      vehicleType: 'semi_tractor',
      condition: 'new',
      make: 'Freightliner',
      model: 'Cascadia 126',
      year: 2026,
      trim: '126 Aero Fleet',
      powertrain: 'Diesel',
      transmission: 'DT12 AMT (Automated Manual)',
      drivetrain: '6x4',
      bodyConfiguration: 'Sleeper Semi-Tractor',
      axleConfiguration: '6x4',
      cabOrSleeper: '72" Raised Roof Sleeper',
      gvwr: { value: 52000, unit: 'lbs' },
      gcwr: { value: 80000, unit: 'lbs' },
      trailerInclusion: 'tractor_only',
      deliveryOrFleetNotes: 'Direct pickup at Columbia Commercial Trucks Portland yard; FET and apportioned IRP plates handled directly by buyer.',
      requiredFields: [
        'vehicleType',
        'condition',
        'make',
        'model',
        'year',
        'powertrain',
        'axleConfiguration',
        'cabOrSleeper',
        'gcwr',
        'trailerInclusion',
      ],
    },
    tallyCertification: buildTrustedTallyCertification(
      'tally_seed',
      'Columbia Commercial Trucks (Fictional Demo Dealer)',
      'Tally coordinated this fictional demo bulk tractor deal with Columbia Commercial Trucks for regional owner-operators and small carriers.'
    ),
    paidPlacement: buildTrustedPaidPlacement(
      'tally_seed',
      'Columbia Commercial Trucks (Fictional Demo Sponsor)'
    ),
    optionGroups: [
      {
        id: 'tractorSpec',
        label: 'Tractor specification',
        required: true,
        allowedValues: ['Cascadia 126 · 6x4 · 72" Sleeper (Tractor Only)'],
        allValues: [
          'Cascadia 126 · 6x4 · 72" Sleeper (Tractor Only)',
          'Day Cab 4x2 (Excluded)',
        ],
      },
      {
        id: 'delivery',
        label: 'Delivery / pickup',
        required: true,
        allowedValues: ['Portland commercial yard pickup'],
        allValues: ['Portland commercial yard pickup'],
      },
    ],
    sellerToken: 'columbia-cascadia-2026',
    quoteRequestedAt: '2026-12-06T18:00:00.000Z',
    currentOffer: {
      version: 1,
      sellerName: 'Columbia Commercial Trucks (Fictional Demo Dealer)',
      sellerLocation: 'Portland, OR (Fictional commercial dealership)',
      matchingScope:
        '5–8× New 2026 Freightliner Cascadia 126 · 6x4 Tandem Axle · 72" Raised Roof Sleeper · Diesel DT12 AMT · Tractor unit only (trailer NOT included)',
      currency: 'USD',
      unitPrice: 164500,
      knownFees: 1250,
      knownFeesUnknown: true,
      itemizedFees: [
        { label: 'Commercial documentation & title prep fee', amount: 650, status: 'fixed' },
        { label: 'Pre-delivery DOT safety inspection & yard prep', amount: 600, status: 'fixed' },
        { label: 'Optional headache rack / wet-kit upfit (quoted per truck if requested)', amount: null, status: 'unknown' },
      ],
      feeLabel: 'Fixed dealer & PDI fees (excludes TBD optional upfit)',
      subtotal: 165750,
      taxTreatment:
        'Excludes Federal Excise Tax (FET), state sales/privilege tax, IRP apportioned plates, and HVUT Form 2290 — verified and paid directly by buyer.',
      taxAndRegistrationNote:
        'Excludes Federal Excise Tax (FET), state tax, IRP registration, and HVUT. Not calculated by Tally.',
      paymentTerms:
        'Direct wire or commercial equipment lender funding to Columbia Commercial Trucks upon delivery; $0 collected by Tally.',
      includedItems: [
        '2026 Freightliner Cascadia 126 72" Raised Roof Sleeper tractor unit (6x4, Diesel, DT12 AMT)',
        'Standard factory 5th wheel and air-slide plate',
        'Pre-delivery inspection at Portland commercial center',
      ],
      excludedItems: [
        'Semi-trailer (tractor unit only — trailer is NOT included)',
        'Federal Excise Tax (FET), state taxes, IRP plates, and licensing',
        'Custom upfit (APU, headache rack, wet-kit) — TBD if ordered separately',
        'Out-of-state transport / drive-away delivery',
      ],
      quotedVehicle: {
        assetClass: 'vehicle',
        vehicleType: 'semi_tractor',
        condition: 'new',
        make: 'Freightliner',
        model: 'Cascadia 126',
        year: 2026,
        trim: '126 Aero Fleet',
        powertrain: 'Diesel',
        transmission: 'DT12 AMT (Automated Manual)',
        drivetrain: '6x4',
        bodyConfiguration: 'Sleeper Semi-Tractor',
        axleConfiguration: '6x4',
        cabOrSleeper: '72" Raised Roof Sleeper',
        gvwr: { value: 52000, unit: 'lbs' },
        gcwr: { value: 80000, unit: 'lbs' },
        trailerInclusion: 'tractor_only',
      },
      minQuantity: 5,
      maxQuantity: 8,
      fulfillmentMethod: 'Direct buyer-to-dealer commercial purchase & pickup at Portland truck center',
      closeAt: '2026-12-19T02:00:00.000Z',
      timezoneLabel: 'Pacific',
      claimByDate: '2026-12-28',
      publishedAt: '2026-12-07T19:00:00.000Z',
      revisionSummary: 'Initial v1 commercial fleet quote for 5–8 Cascadia 126 sleeper tractors (tractor unit only).',
      privateClaimInstructions:
        'SIMULATED DEMO INSTRUCTIONS: Present claim code to Columbia Commercial Trucks Fleet Desk in Portland by Dec 28, 2026 to execute commercial buyer order directly with dealer.',
      privateReferencePrefix: 'CCT-CASC-2026',
    },
    offerHistory: [],
    members: [
      {
        id: 'semi-1',
        userId: 'org-devon',
        displayName: 'Devon Brooks (Organizer)',
        location: 'Portland metro',
        quantity: 2,
        selectedOptions: {
          tractorSpec: 'Cascadia 126 · 6x4 · 72" Sleeper (Tractor Only)',
          delivery: 'Portland commercial yard pickup',
        },
        joinedAt: '2026-12-02T18:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-07T20:00:00.000Z',
      },
      {
        id: 'semi-2',
        userId: 'mem-semi-2',
        displayName: 'Cascade Linehaul LLC',
        location: 'Vancouver, WA',
        quantity: 2,
        selectedOptions: {
          tractorSpec: 'Cascadia 126 · 6x4 · 72" Sleeper (Tractor Only)',
          delivery: 'Portland commercial yard pickup',
        },
        joinedAt: '2026-12-04T18:00:00.000Z',
        status: 'confirmed',
        confirmedVersion: 1,
        confirmedAt: '2026-12-08T01:00:00.000Z',
      },
      {
        id: 'semi-3',
        userId: PERSONAS.buyer.id,
        displayName: PERSONAS.buyer.name,
        location: 'Portland metro',
        quantity: 1,
        selectedOptions: {
          tractorSpec: 'Cascadia 126 · 6x4 · 72" Sleeper (Tractor Only)',
          delivery: 'Portland commercial yard pickup',
        },
        joinedAt: '2026-12-05T18:00:00.000Z',
        status: 'interested',
        privateEmail: PERSONAS.buyer.email,
        privatePhone: PERSONAS.buyer.phone,
      },
    ],
    discussion: [
      {
        id: 'semi-disc-1',
        authorId: 'org-devon',
        authorName: PERSONAS.organizer.name,
        authorRole: 'organizer',
        body: 'Reminder: Quote v1 is for the 6x4 sleeper tractor unit only (no semi-trailer). Optional wet-kit/headache rack upfit is marked TBD and excluded from the base subtotal.',
        createdAt: '2026-12-07T20:30:00.000Z',
        isOrganizerUpdate: true,
      },
    ],
    followers: [],
    createdAt: '2026-12-02T17:00:00.000Z',
    updatedAt: '2026-12-08T01:00:00.000Z',
  };

  return [
    walnutTablePool,
    burnsidePool,
    hotelPool,
    vinylPool,
    heatPumpPool,
    evChargerPool,
    subaruOutbackPool,
    isuzuBoxTruckPool,
    shuttleBusPool,
    cascadiaSemiPool,
  ];
}

export function buildMaverickScenarioActivity(
  scenarioId: DemoScenarioId,
  demoNow: string
): ActivityEvent {
  return {
    id: `act-seed-maverick-${scenarioId}`,
    poolId: 'pool-maverick-xlt',
    poolTitle: '2026 Ford Maverick XLT Hybrid AWD',
    kind:
      scenarioId === 'just-unlocked'
        ? 'unlocked'
        : scenarioId === 'missed-deadline'
          ? 'expired'
          : scenarioId === 'reviewing-6-of-8'
            ? 'offer_published'
            : 'joined',
    summary:
      scenarioId === 'gathering-7-of-8'
        ? '7 of 8 eligible vehicles gathered in Portland metro (1 more needed to request a quote).'
        : scenarioId === 'ready-for-quote'
          ? '8 of 8 eligible vehicles reached — organizer can request a seller quote.'
          : scenarioId === 'reviewing-6-of-8'
            ? 'Alder Motor Co. published Offer v1 ($28,295 subtotal). 6 of 8 vehicles confirmed.'
            : scenarioId === 'just-unlocked'
              ? '8 of 8 vehicles confirmed — Alder Motor Co. group price $28,295 is unlocked.'
              : 'Offer v1 closed at Dec 14, 6:00 PM Pacific with 7 of 8 vehicles confirmed (one buyer short).',
    createdAt: demoNow,
  };
}

export function createSeedSession(
  sessionId: string,
  scenarioId: DemoScenarioId = 'gathering-7-of-8'
): DemoSessionState {
  const demoNow =
    scenarioId === 'missed-deadline' ? MAVERICK_EXPIRED_DEMO_NOW : DEFAULT_DEMO_NOW;

  const maverickPool = buildMaverickPool(scenarioId);
  const otherPools = buildOtherDirectoryPools();

  const initialActivity: ActivityEvent[] = [
    buildMaverickScenarioActivity(scenarioId, demoNow),
    {
      id: 'act-seed-1',
      poolId: 'pool-walnut-dining',
      poolTitle: 'Solid Walnut 8-Seat Dining Table',
      kind: 'unlocked',
      summary: '6 of 6 furniture units confirmed — group price $1,505 unlocked.',
      createdAt: '2026-12-06T18:00:00.000Z',
    },
  ];

  return {
    sessionId,
    scenarioId,
    demoNow,
    pools: [maverickPool, ...otherPools],
    activity: initialActivity,
    alerts: [],
    notifications: [],
    createdAt: demoNow,
    updatedAt: demoNow,
  };
}
