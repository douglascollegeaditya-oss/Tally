import {
  VEHICLE_SUBTYPES,
  type DistanceUnit,
  type MeasuredValue,
  type PaidPlacementMeta,
  type Pool,
  type PoolMetrics,
  type PoolSpecField,
  type QuoteFeeItem,
  type SellerOffer,
  type TallyCertificationMeta,
  type TrailerInclusion,
  type VehicleAssetClass,
  type VehicleCompatibilityReport,
  type VehicleCondition,
  type VehicleSpecProfile,
  type VehicleSubType,
  type WeightUnit,
} from './types.ts';

export interface VehicleTypeMeta {
  id: VehicleSubType;
  label: string;
  shortLabel: string;
  description: string;
  commercial: boolean;
}

export const VEHICLE_TYPE_META: Record<VehicleSubType, VehicleTypeMeta> = {
  passenger: {
    id: 'passenger',
    label: 'Passenger cars & SUVs',
    shortLabel: 'Passenger car / SUV',
    description: 'Sedans, hatchbacks, wagons, SUVs, crossovers, and minivans',
    commercial: false,
  },
  pickup: {
    id: 'pickup',
    label: 'Pickups',
    shortLabel: 'Pickup truck',
    description: 'Compact, midsize, half-ton, and heavy-duty pickup trucks',
    commercial: false,
  },
  commercial_van_truck: {
    id: 'commercial_van_truck',
    label: 'Commercial vans & trucks',
    shortLabel: 'Commercial van / truck',
    description: 'Cargo vans, step vans, box trucks, chassis cabs, flatbeds, and vocational trucks',
    commercial: true,
  },
  bus: {
    id: 'bus',
    label: 'Buses',
    shortLabel: 'Bus',
    description: 'Shuttle buses, minibuses, transit buses, school buses, and motorcoaches',
    commercial: true,
  },
  semi_tractor: {
    id: 'semi_tractor',
    label: 'Semi-tractors (18-wheelers)',
    shortLabel: 'Semi-tractor',
    description: 'Day cab and sleeper tractor units (trailer not included unless explicitly stated)',
    commercial: true,
  },
};

export const VEHICLE_TYPE_LIST: readonly VehicleTypeMeta[] = VEHICLE_SUBTYPES.map(
  (id) => VEHICLE_TYPE_META[id]
);

export const TALLY_CERTIFIED_DISCLAIMER =
  'Tally organized this bulk deal directly with a participating dealer. Tally Certified does not guarantee lowest pricing, future stock availability, financing terms, or independent dealer verification.';

export const VEHICLE_FIELD_LABELS: Record<string, string> = {
  vehicleType: 'Vehicle type',
  condition: 'New / used condition',
  make: 'Make',
  model: 'Model',
  year: 'Model year / range',
  trim: 'Trim / configuration',
  powertrain: 'Fuel / powertrain',
  transmission: 'Transmission',
  drivetrain: 'Drivetrain',
  bodyConfiguration: 'Body / configuration',
  axleConfiguration: 'Axle configuration',
  gvwr: 'GVWR',
  gcwr: 'GCWR',
  payloadCapacity: 'Payload capacity',
  towingCapacity: 'Towing capacity',
  cabOrSleeper: 'Cab / sleeper',
  trailerInclusion: 'Trailer inclusion',
  busType: 'Bus type',
  seatingCapacity: 'Seating capacity',
  accessibilityRequirement: 'Accessibility / ADA',
  maxMileage: 'Max mileage (used)',
};

const VALID_WEIGHT_UNITS = new Set<string>(['lbs', 'kg']);
const VALID_DISTANCE_UNITS = new Set<string>(['mi', 'km']);
const VALID_SUBTYPES = new Set<string>(VEHICLE_SUBTYPES);
const VALID_CONDITIONS = new Set<string>(['new', 'used']);
const VALID_TRAILER_INCLUSIONS = new Set<string>(['tractor_only', 'includes_trailer']);
const VALID_ASSET_CLASSES = new Set<string>(['vehicle', 'accessory']);

const MIN_MODEL_YEAR = 1980;
const MAX_MODEL_YEAR = 2030;
const KG_TO_LBS = 2.20462262;
const KM_TO_MI = 0.62137119;

const ACCESSORY_SIGNAL_RE =
  /\b(ev\s*charger|wallbox|charging\s*station|level\s*2\s*charger|floor\s*mat|roof\s*rack|dash\s*cam|charging\s*cable|adapter|tire\s*chains?)\b/i;

const SEMI_SIGNAL_RE =
  /\b(semi[-\s]*tractor|semi[-\s]*truck|18[-\s]*wheeler|tractor\s*unit|class\s*8\s*tractor|sleeper\s*tractor|day\s*cab\s*tractor|cascadia|kenworth\s*t\d+|peterbilt\s*\d+|volvo\s*vnl|mack\s*anthem|international\s*lt)\b/i;

const BUS_SIGNAL_RE =
  /\b(shuttle\s*bus|school\s*bus|transit\s*bus|motorcoach|minibus|coach\s*bus|passenger\s*bus|\bbus\b)\b/i;

const COMMERCIAL_TRUCK_SIGNAL_RE =
  /\b(box\s*truck|cargo\s*van|step\s*van|sprinter\s*van|transit\s*250|transit\s*350|promaster|chassis\s*cab|flatbed\s*truck|dump\s*truck|reefer\s*truck|isuzu\s*npr|commercial\s*truck|commercial\s*van|work\s*van|cutaway\s*van)\b/i;

const PICKUP_SIGNAL_RE =
  /\b(pickup|pick-up|maverick|f-?150|f-?250|f-?350|silverado|sierra\s*1500|tacoma|tundra|ranger|colorado|ram\s*1500|frontier|ridgeline)\b/i;

const PASSENGER_SIGNAL_RE =
  /\b(sedan|suv|crossover|hatchback|wagon|minivan|coupe|outback|rav4|cr-?v|camry|accord|civic|corolla|forester|highlander|model\s*[3y]|ioniq\s*5|prius)\b/i;

const UNTRUSTED_PLACEMENT_KEYS = [
  'tallyCertification',
  'paidPlacement',
  'certified',
  'tallyCertified',
  'paidFeatured',
  'sponsored',
  'featured',
  'placementTier',
] as const;

export function getVehicleTypeLabel(type?: VehicleSubType, short = false): string {
  if (!type || !VEHICLE_TYPE_META[type]) return 'Not specified';
  return short ? VEHICLE_TYPE_META[type].shortLabel : VEHICLE_TYPE_META[type].label;
}

export function formatMeasuredValue(
  measured: MeasuredValue<WeightUnit | DistanceUnit> | undefined
): string | null {
  if (!measured || !Number.isFinite(measured.value) || measured.value <= 0) return null;
  return `${Math.round(measured.value).toLocaleString('en-US')} ${measured.unit}`;
}

export function formatYearRequirement(specs?: VehicleSpecProfile): string | null {
  if (!specs) return null;
  if (Number.isInteger(specs.yearMin) && Number.isInteger(specs.yearMax)) {
    return specs.yearMin === specs.yearMax
      ? String(specs.yearMin)
      : `${specs.yearMin}–${specs.yearMax}`;
  }
  if (Number.isInteger(specs.year)) {
    return String(specs.year);
  }
  if (Number.isInteger(specs.yearMin)) {
    return `${specs.yearMin}+`;
  }
  if (Number.isInteger(specs.yearMax)) {
    return `Up to ${specs.yearMax}`;
  }
  return null;
}

export function formatTrailerInclusion(
  inclusion?: TrailerInclusion,
  vehicleType?: VehicleSubType
): string | null {
  if (inclusion === 'includes_trailer') {
    return 'Trailer explicitly included';
  }
  if (inclusion === 'tractor_only') {
    return 'Tractor unit only — trailer NOT included';
  }
  if (vehicleType === 'semi_tractor') {
    return 'Trailer inclusion not specified (do not assume trailer is included)';
  }
  return null;
}

export function isAccessoryPool(pool: Pick<Pool, 'category' | 'title' | 'unitSingular' | 'vehicleSpecs'>): boolean {
  if (pool.category !== 'Vehicles') return false;
  if (pool.vehicleSpecs?.assetClass === 'accessory') return true;
  if (pool.vehicleSpecs?.assetClass === 'vehicle') return false;
  const combined = `${pool.title} ${pool.unitSingular}`;
  return ACCESSORY_SIGNAL_RE.test(combined);
}

/**
 * Strips any client-supplied trust, certification, or paid placement fields from untrusted input
 * so ordinary users/organizers/sellers can never self-certify or self-sponsor a listing.
 */
export function stripUntrustedPlacementFields<T extends Record<string, unknown>>(raw: T): T {
  const copy = { ...raw };
  for (const key of UNTRUSTED_PLACEMENT_KEYS) {
    if (key in copy) {
      delete copy[key];
    }
  }
  return copy;
}

function cleanStr(val: unknown, maxLen = 120): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateMeasuredWeight(
  raw: unknown,
  fieldKey: string,
  label: string,
  errors: Record<string, string>
): MeasuredValue<WeightUnit> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    errors[fieldKey] = `${label} must include a numeric value and unit (lbs or kg).`;
    return undefined;
  }
  const obj = raw as { value?: unknown; unit?: unknown };
  if (obj.value === '' || obj.value === undefined || obj.value === null) return undefined;
  const num = Number(obj.value);
  const unit = typeof obj.unit === 'string' ? obj.unit.trim().toLowerCase() : '';
  if (!Number.isFinite(num) || num <= 0 || num > 500000) {
    errors[fieldKey] = `${label} must be a positive number (up to 500,000).`;
    return undefined;
  }
  if (!VALID_WEIGHT_UNITS.has(unit)) {
    errors[fieldKey] = `${label} requires an explicit unit (lbs or kg).`;
    return undefined;
  }
  return { value: Math.round(num), unit: unit as WeightUnit };
}

function validateMeasuredDistance(
  raw: unknown,
  fieldKey: string,
  label: string,
  errors: Record<string, string>
): MeasuredValue<DistanceUnit> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    errors[fieldKey] = `${label} must include a numeric value and unit (mi or km).`;
    return undefined;
  }
  const obj = raw as { value?: unknown; unit?: unknown };
  if (obj.value === '' || obj.value === undefined || obj.value === null) return undefined;
  const num = Number(obj.value);
  const unit = typeof obj.unit === 'string' ? obj.unit.trim().toLowerCase() : '';
  if (!Number.isFinite(num) || num < 0 || num > 3000000) {
    errors[fieldKey] = `${label} must be 0 or greater (up to 3,000,000).`;
    return undefined;
  }
  if (!VALID_DISTANCE_UNITS.has(unit)) {
    errors[fieldKey] = `${label} requires an explicit unit (mi or km).`;
    return undefined;
  }
  return { value: Math.round(num), unit: unit as DistanceUnit };
}

export function validateVehicleSpecs(raw: unknown): {
  valid: boolean;
  errors: Record<string, string>;
  sanitized: VehicleSpecProfile | undefined;
} {
  if (raw === undefined || raw === null) {
    return { valid: true, errors: {}, sanitized: undefined };
  }
  if (typeof raw !== 'object') {
    return {
      valid: false,
      errors: { vehicleSpecs: 'Vehicle specifications must be a structured object.' },
      sanitized: undefined,
    };
  }

  const input = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const out: VehicleSpecProfile = {};

  if (input.assetClass !== undefined && input.assetClass !== '') {
    const ac = String(input.assetClass).trim();
    if (!VALID_ASSET_CLASSES.has(ac)) {
      errors['vehicleSpecs.assetClass'] = 'Select either motor vehicle or vehicle accessory.';
    } else {
      out.assetClass = ac as VehicleAssetClass;
    }
  }

  if (input.vehicleType !== undefined && input.vehicleType !== '') {
    const vt = String(input.vehicleType).trim();
    if (!VALID_SUBTYPES.has(vt)) {
      errors['vehicleSpecs.vehicleType'] = 'Select a supported vehicle type.';
    } else {
      out.vehicleType = vt as VehicleSubType;
      if (!out.assetClass) out.assetClass = 'vehicle';
    }
  }

  if (input.condition !== undefined && input.condition !== '') {
    const cond = String(input.condition).trim().toLowerCase();
    if (!VALID_CONDITIONS.has(cond)) {
      errors['vehicleSpecs.condition'] = 'Condition must be New, Used, or left unspecified.';
    } else {
      out.condition = cond as VehicleCondition;
    }
  }

  out.make = cleanStr(input.make, 60);
  out.model = cleanStr(input.model, 80);
  out.trim = cleanStr(input.trim, 80);
  out.powertrain = cleanStr(input.powertrain, 60);
  out.transmission = cleanStr(input.transmission, 60);
  out.drivetrain = cleanStr(input.drivetrain, 60);
  out.bodyConfiguration = cleanStr(input.bodyConfiguration, 80);
  out.axleConfiguration = cleanStr(input.axleConfiguration, 40);
  out.cabOrSleeper = cleanStr(input.cabOrSleeper, 80);
  out.busType = cleanStr(input.busType, 60);
  out.accessibilityRequirement = cleanStr(input.accessibilityRequirement, 100);
  out.usedConditionNote = cleanStr(input.usedConditionNote, 240);
  out.deliveryOrFleetNotes = cleanStr(input.deliveryOrFleetNotes, 300);

  if (input.trailerInclusion !== undefined && input.trailerInclusion !== '') {
    const ti = String(input.trailerInclusion).trim();
    if (!VALID_TRAILER_INCLUSIONS.has(ti)) {
      errors['vehicleSpecs.trailerInclusion'] = 'Select tractor-only, trailer included, or unspecified.';
    } else {
      out.trailerInclusion = ti as TrailerInclusion;
    }
  }

  const parseYearField = (val: unknown, key: string, label: string): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const n = Number(val);
    if (!Number.isInteger(n) || n < MIN_MODEL_YEAR || n > MAX_MODEL_YEAR) {
      errors[key] = `${label} must be a whole year between ${MIN_MODEL_YEAR} and ${MAX_MODEL_YEAR}.`;
      return undefined;
    }
    return n;
  };

  out.year = parseYearField(input.year, 'vehicleSpecs.year', 'Model year');
  out.yearMin = parseYearField(input.yearMin, 'vehicleSpecs.yearMin', 'Minimum model year');
  out.yearMax = parseYearField(input.yearMax, 'vehicleSpecs.yearMax', 'Maximum model year');

  if (out.yearMin !== undefined && out.yearMax !== undefined && out.yearMin > out.yearMax) {
    errors['vehicleSpecs.yearMax'] = 'Maximum accepted model year cannot be earlier than minimum year.';
  }
  // If an explicit range is supplied alongside a single year, keep the range authoritative unless identical
  if (out.yearMin !== undefined && out.yearMax !== undefined && out.yearMin === out.yearMax) {
    out.year = out.yearMin;
  }

  out.gvwr = validateMeasuredWeight(input.gvwr, 'vehicleSpecs.gvwr', 'GVWR', errors);
  out.gcwr = validateMeasuredWeight(input.gcwr, 'vehicleSpecs.gcwr', 'GCWR', errors);
  out.payloadCapacity = validateMeasuredWeight(
    input.payloadCapacity,
    'vehicleSpecs.payloadCapacity',
    'Payload capacity',
    errors
  );
  out.towingCapacity = validateMeasuredWeight(
    input.towingCapacity,
    'vehicleSpecs.towingCapacity',
    'Towing capacity',
    errors
  );

  if (
    input.seatingCapacity !== undefined &&
    input.seatingCapacity !== null &&
    input.seatingCapacity !== ''
  ) {
    const seats = Number(input.seatingCapacity);
    if (!Number.isInteger(seats) || seats < 4 || seats > 120) {
      errors['vehicleSpecs.seatingCapacity'] =
        'Seating capacity must be a whole number between 4 and 120 passengers.';
    } else {
      out.seatingCapacity = seats;
    }
  }

  out.mileage = validateMeasuredDistance(input.mileage, 'vehicleSpecs.mileage', 'Mileage', errors);
  out.maxMileage = validateMeasuredDistance(
    input.maxMileage,
    'vehicleSpecs.maxMileage',
    'Maximum mileage',
    errors
  );

  if (Array.isArray(input.requiredFields)) {
    const allowedReqKeys = new Set(Object.keys(VEHICLE_FIELD_LABELS));
    const reqs = Array.from(
      new Set(
        input.requiredFields
          .filter((k): k is string => typeof k === 'string' && allowedReqKeys.has(k))
      )
    );
    if (reqs.length > 0) {
      out.requiredFields = reqs;
    }
  }

  // Strip undefined entries for clean JSON persistence
  const cleaned = Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined)
  ) as VehicleSpecProfile;

  const hasAnyValue = Object.keys(cleaned).length > 0;
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: hasAnyValue ? cleaned : undefined,
  };
}

/**
 * Builds honest, readable PoolSpecField rows from structured VehicleSpecProfile
 * without asserting weight classes, legal compliance, or OEM capacities.
 */
export function buildVehicleCategorySpecs(
  specs: VehicleSpecProfile | undefined,
  fallbackLocation?: string
): PoolSpecField[] {
  if (!specs) return [];
  const rows: PoolSpecField[] = [];

  if (specs.assetClass === 'accessory') {
    rows.push({ label: 'Classification', value: 'Vehicle accessory / equipment (not a motor vehicle)' });
    return rows;
  }

  if (specs.vehicleType) {
    rows.push({ label: 'Vehicle type', value: getVehicleTypeLabel(specs.vehicleType, true) });
  }
  if (specs.condition) {
    rows.push({ label: 'Condition', value: specs.condition === 'new' ? 'New' : 'Used' });
  }
  const makeModel = [specs.make, specs.model].filter(Boolean).join(' ');
  const yearLabel = formatYearRequirement(specs);
  if (makeModel || yearLabel) {
    rows.push({
      label: 'Model',
      value: [yearLabel, makeModel].filter(Boolean).join(' ') || 'Not specified',
    });
  }
  if (specs.trim) {
    rows.push({ label: 'Trim', value: specs.trim });
  }
  const powerDrive = [specs.powertrain, specs.drivetrain, specs.transmission].filter(Boolean).join(' · ');
  if (powerDrive) {
    rows.push({ label: 'Powertrain & drive', value: powerDrive });
  }
  if (specs.bodyConfiguration) {
    rows.push({ label: 'Body / config', value: specs.bodyConfiguration });
  }
  if (specs.axleConfiguration) {
    rows.push({ label: 'Axle config', value: specs.axleConfiguration });
  }
  if (specs.cabOrSleeper) {
    rows.push({ label: 'Cab / sleeper', value: specs.cabOrSleeper });
  }
  const gvwrStr = formatMeasuredValue(specs.gvwr);
  if (gvwrStr) rows.push({ label: 'GVWR', value: gvwrStr });
  const gcwrStr = formatMeasuredValue(specs.gcwr);
  if (gcwrStr) rows.push({ label: 'GCWR', value: gcwrStr });
  const payloadStr = formatMeasuredValue(specs.payloadCapacity);
  if (payloadStr) rows.push({ label: 'Payload', value: payloadStr });
  const towingStr = formatMeasuredValue(specs.towingCapacity);
  if (towingStr) rows.push({ label: 'Towing', value: towingStr });

  if (specs.vehicleType === 'semi_tractor' || specs.trailerInclusion) {
    const trailerText = formatTrailerInclusion(specs.trailerInclusion, specs.vehicleType);
    if (trailerText) rows.push({ label: 'Trailer', value: trailerText });
  }
  if (specs.busType) {
    rows.push({ label: 'Bus type', value: specs.busType });
  }
  if (specs.seatingCapacity !== undefined) {
    rows.push({ label: 'Seating capacity', value: `${specs.seatingCapacity} passengers` });
  }
  if (specs.accessibilityRequirement) {
    rows.push({ label: 'Accessibility', value: specs.accessibilityRequirement });
  }
  const maxMileStr = formatMeasuredValue(specs.maxMileage);
  if (maxMileStr) rows.push({ label: 'Max mileage', value: maxMileStr });
  const mileStr = formatMeasuredValue(specs.mileage);
  if (mileStr) rows.push({ label: 'Mileage', value: mileStr });

  if (fallbackLocation && rows.length < 8) {
    rows.push({ label: 'Pickup / delivery', value: fallbackLocation });
  }

  return rows;
}

/**
 * Non-destructive migration for legacy vehicle pools stored in older sessions.
 * Preserves existing fields and leaves unspecified attributes as undefined (unknown)
 * rather than fabricating condition, weight ratings, axle configs, or makes/models.
 */
export function migrateLegacyVehiclePool(pool: Pool): Pool {
  if (pool.category !== 'Vehicles') {
    return pool;
  }

  // Keep existing valid structured specs untouched
  if (pool.vehicleSpecs && Object.keys(pool.vehicleSpecs).length > 0) {
    // Ensure legacy EV charger is never misclassified as a vehicle
    if (pool.id === 'pool-ev-charger-sea' && pool.vehicleSpecs.assetClass !== 'accessory') {
      return {
        ...pool,
        vehicleSpecs: { assetClass: 'accessory' },
      };
    }
    return pool;
  }

  // Known seeded EV charger fixture -> explicitly accessory, NOT a motor vehicle
  if (pool.id === 'pool-ev-charger-sea' || ACCESSORY_SIGNAL_RE.test(`${pool.title} ${pool.unitSingular}`)) {
    return {
      ...pool,
      vehicleSpecs: {
        assetClass: 'accessory',
      },
    };
  }

  // Known seeded Ford Maverick fixture -> populate ONLY facts already explicitly stated in its legacy record
  if (pool.id === 'pool-maverick-xlt') {
    return {
      ...pool,
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
    };
  }

  // Generic legacy custom Vehicles pool: extract ONLY explicit single model year if present;
  // leave vehicleType, condition, make, model, trim, commercial specs honestly unknown (undefined).
  const yearMatches = Array.from(pool.title.matchAll(/\b((?:19|20)\d{2})\b/g)).map((m) => Number(m[1]));
  const uniqueYears = Array.from(new Set(yearMatches)).filter(
    (y) => y >= MIN_MODEL_YEAR && y <= MAX_MODEL_YEAR
  );
  if (uniqueYears.length === 1) {
    return {
      ...pool,
      vehicleSpecs: {
        year: uniqueYears[0],
      },
    };
  }
  if (uniqueYears.length >= 2) {
    return {
      ...pool,
      vehicleSpecs: {
        yearMin: Math.min(...uniqueYears),
        yearMax: Math.max(...uniqueYears),
      },
    };
  }

  return pool;
}

// ============================================================================
// UNIFIED VEHICLE COMPATIBILITY MODEL
// Shared across Explore filtering, Competing-Pools Comparison, Pool Detail,
// and Dealer Quote Review.
// ============================================================================

function normalizeTokenText(val?: string): string {
  if (!val) return '';
  return val
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalPowertrain(raw?: string, strictKnownOnly = false): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\b(phev|plug\s*in\s*hybrid)\b/.test(norm)) return 'phev';
  if (/\b(hybrid)\b/.test(norm)) return 'hybrid';
  if (/\b(bev|battery\s*electric|full\s*electric|\belectric\b|\bev\b)\b/.test(norm)) return 'electric';
  if (/\b(diesel)\b/.test(norm)) return 'diesel';
  if (/\b(cng|propane|lpg|natural\s*gas)\b/.test(norm)) return 'cng_propane';
  if (/\b(ecoboost|gas|gasoline|petrol|ice)\b/.test(norm)) return 'gasoline';
  return strictKnownOnly ? null : norm;
}

function canonicalDrivetrain(raw?: string, strictKnownOnly = false): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\b(awd|all\s*wheel\s*drive)\b/.test(norm)) return 'awd';
  if (/\b(4wd|4x4|four\s*wheel\s*drive)\b/.test(norm)) return '4wd';
  if (/\b(fwd|front\s*wheel\s*drive)\b/.test(norm)) return 'fwd';
  if (/\b(rwd|rear\s*wheel\s*drive)\b/.test(norm)) return 'rwd';
  if (/\b(2wd|two\s*wheel\s*drive)\b/.test(norm)) return '2wd';
  if (/\b(6x4)\b/.test(norm)) return '6x4';
  if (/\b(6x2)\b/.test(norm)) return '6x2';
  if (/\b(4x2)\b/.test(norm)) return '4x2';
  return strictKnownOnly ? null : norm;
}

function canonicalAxle(raw?: string, strictKnownOnly = false): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  const match = norm.match(/\b([468])\s*x\s*([2468])\b/);
  if (match) return `${match[1]}x${match[2]}`;
  if (/\btandem\b/.test(norm)) return '6x4';
  if (/\bsingle\s*axle\b/.test(norm)) return '4x2';
  return strictKnownOnly ? null : norm;
}

function canonicalCab(raw?: string, strictKnownOnly = false): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\bday\s*cab\b/.test(norm)) return 'day_cab';
  if (/\bsleeper\b/.test(norm)) return 'sleeper';
  if (/\bcrew\s*cab\b/.test(norm)) return 'crew_cab';
  if (/\bextended\s*cab|supercab|double\s*cab\b/.test(norm)) return 'extended_cab';
  if (/\bregular\s*cab|standard\s*cab\b/.test(norm)) return 'regular_cab';
  return strictKnownOnly ? null : norm;
}

function canonicalBusType(raw?: string, strictKnownOnly = false): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\bschool\b/.test(norm)) return 'school';
  if (/\bshuttle\b/.test(norm)) return 'shuttle';
  if (/\btransit\b/.test(norm)) return 'transit';
  if (/\bmotorcoach|coach\b/.test(norm)) return 'motorcoach';
  if (/\bminibus|mini\s*bus\b/.test(norm)) return 'minibus';
  return strictKnownOnly ? null : norm;
}

function canonicalBodyConfig(raw?: string): string | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\breefer|refrigerated\b/.test(norm)) return 'reefer';
  if (/\bflatbed\b/.test(norm)) return 'flatbed';
  if (/\bdump\b/.test(norm)) return 'dump';
  if (/\bbox\s*truck|dry\s*van|dry\s*freight\b/.test(norm)) return 'box_truck';
  if (/\bstep\s*van\b/.test(norm)) return 'step_van';
  if (/\bcargo\s*van\b/.test(norm)) return 'cargo_van';
  if (/\bchassis\s*cab\b/.test(norm)) return 'chassis_cab';
  return norm;
}

function canonicalAda(raw?: string): 'ada_required' | 'non_ada' | null {
  const norm = normalizeTokenText(raw);
  if (!norm) return null;
  if (/\b(no\s*lift|non\s*ada|no\s*ada|standard\s*non\s*lift|without\s*lift|without\s*wheelchair)\b/.test(norm)) {
    return 'non_ada';
  }
  if (/\b(ada|wheelchair|lift|ramp|tie\s*down|accessible|paratransit)\b/.test(norm)) {
    return 'ada_required';
  }
  return null;
}

function getYearRange(specs?: VehicleSpecProfile): [number, number] | null {
  if (!specs) return null;
  if (Number.isInteger(specs.yearMin) && Number.isInteger(specs.yearMax)) {
    return [specs.yearMin!, specs.yearMax!];
  }
  if (Number.isInteger(specs.year)) {
    return [specs.year!, specs.year!];
  }
  if (Number.isInteger(specs.yearMin)) {
    return [specs.yearMin!, MAX_MODEL_YEAR];
  }
  if (Number.isInteger(specs.yearMax)) {
    return [MIN_MODEL_YEAR, specs.yearMax!];
  }
  return null;
}

function toLbs(m?: MeasuredValue<WeightUnit>): number | null {
  if (!m || !Number.isFinite(m.value) || m.value <= 0) return null;
  return m.unit === 'kg' ? m.value * KG_TO_LBS : m.value;
}

function toMiles(m?: MeasuredValue<DistanceUnit>): number | null {
  if (!m || !Number.isFinite(m.value) || m.value < 0) return null;
  return m.unit === 'km' ? m.value * KM_TO_MI : m.value;
}

/**
 * Extracts explicit structured vehicle signals from free text (search queries or quote scopes)
 * and merges them with any explicit VehicleSpecProfile (explicit fields take precedence).
 * Never guesses unspecified fields.
 */
export function inferVehicleSignalsFromText(
  text: string,
  explicit?: VehicleSpecProfile
): VehicleSpecProfile {
  const inferred: VehicleSpecProfile = {};
  const cleanText = (text || '').slice(0, 600);

  if (ACCESSORY_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'accessory';
  } else if (SEMI_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'vehicle';
    inferred.vehicleType = 'semi_tractor';
  } else if (BUS_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'vehicle';
    inferred.vehicleType = 'bus';
  } else if (COMMERCIAL_TRUCK_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'vehicle';
    inferred.vehicleType = 'commercial_van_truck';
  } else if (PICKUP_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'vehicle';
    inferred.vehicleType = 'pickup';
  } else if (PASSENGER_SIGNAL_RE.test(cleanText)) {
    inferred.assetClass = 'vehicle';
    inferred.vehicleType = 'passenger';
  }

  // Explicit condition word (new vs used)
  const hasUsed = /\b(used|pre[-\s]*owned|second[-\s]*hand)\b/i.test(cleanText);
  const hasNew = /\b(brand\s*new|\bnew\b)\b/i.test(cleanText);
  if (hasUsed && !hasNew) {
    inferred.condition = 'used';
  } else if (hasNew && !hasUsed) {
    inferred.condition = 'new';
  }

  // Explicit year range (e.g., 2024-2026) or single year
  const rangeMatch = cleanText.match(/\b((?:19|20)\d{2})\s*[-–to]+\s*((?:19|20)\d{2})\b/i);
  if (rangeMatch) {
    const y1 = Number(rangeMatch[1]);
    const y2 = Number(rangeMatch[2]);
    if (y1 >= MIN_MODEL_YEAR && y2 <= MAX_MODEL_YEAR && y1 <= y2) {
      inferred.yearMin = y1;
      inferred.yearMax = y2;
    }
  } else {
    const years = Array.from(cleanText.matchAll(/\b((?:19|20)\d{2})\b/g))
      .map((m) => Number(m[1]))
      .filter((y) => y >= MIN_MODEL_YEAR && y <= MAX_MODEL_YEAR);
    const unique = Array.from(new Set(years));
    if (unique.length === 1) {
      inferred.year = unique[0];
    } else if (unique.length >= 2) {
      inferred.yearMin = Math.min(...unique);
      inferred.yearMax = Math.max(...unique);
    }
  }

  // Explicit axle configuration (e.g. 6x4, 4x2, 6x2)
  const axleMatch = cleanText.match(/\b([468]\s*x\s*[2468])\b/i);
  if (axleMatch) {
    inferred.axleConfiguration = axleMatch[1].replace(/\s+/g, '').toLowerCase();
  }

  // Explicit trailer inclusion language
  if (/\b(trailer\s+not\s+included|without\s+trailer|tractor\s+only|tractor\s+unit\s+only|no\s+trailer)\b/i.test(cleanText)) {
    inferred.trailerInclusion = 'tractor_only';
  } else if (/\b(with\s+trailer|includes\s+trailer|trailer\s+included|tractor\s*\+\s*trailer)\b/i.test(cleanText)) {
    inferred.trailerInclusion = 'includes_trailer';
  }

  // Explicit powertrain / drivetrain from text (strict known keywords only — never raw query string)
  const pwr = canonicalPowertrain(cleanText, true);
  if (pwr) inferred.powertrain = pwr;
  const drv = canonicalDrivetrain(cleanText, true);
  if (drv) inferred.drivetrain = drv;

  // Explicit bus type / seats / ADA
  const bType = canonicalBusType(cleanText, true);
  if (bType && inferred.vehicleType === 'bus') inferred.busType = bType;
  const seatMatch = cleanText.match(/\b(\d{1,3})\s*[-]?\s*(?:passenger|seat|seater)\b/i);
  if (seatMatch) {
    const seats = Number(seatMatch[1]);
    if (seats >= 4 && seats <= 120) inferred.seatingCapacity = seats;
  }
  const ada = canonicalAda(cleanText);
  if (ada) {
    inferred.accessibilityRequirement = ada === 'ada_required' ? 'ADA lift / wheelchair accessible' : 'Non-ADA / no lift';
  }

  // Explicit cab/sleeper
  const cab = canonicalCab(cleanText, true);
  if (cab) inferred.cabOrSleeper = cab;

  // Merge: explicit structured values always override text inference
  return {
    ...inferred,
    ...(explicit ?? {}),
    ...(explicit?.vehicleType && !explicit.assetClass ? { assetClass: 'vehicle' as const } : {}),
  };
}

/**
 * Unified Vehicle Compatibility Model.
 * Compares a requested VehicleSpecProfile (from a buyer search, draft pool, or pool requirement)
 * against a candidate VehicleSpecProfile (from an existing pool or a dealer quote).
 *
 * Rules:
 * - Explicit conflicts on asset class, vehicle type, condition, make, model, year range, trim,
 *   powertrain, drivetrain, axle, trailer inclusion, bus type, seating, ADA, capacity, or mileage
 *   ALWAYS produce `compatible: false, status: 'conflict'`.
 * - Missing / unknown attributes on either side NEVER create false exact fits; they populate
 *   `unverifiedFields` and yield `status: 'possible_verify'`.
 * - Fuzzy spelling NEVER overrides structured conflicts.
 */
export function evaluateVehicleCompatibility(
  requested: VehicleSpecProfile | undefined,
  candidate: VehicleSpecProfile | undefined,
  options?: { mode?: 'pool_comparison' | 'quote_review' }
): VehicleCompatibilityReport {
  const mode = options?.mode ?? 'pool_comparison';
  const req = requested ?? {};
  const cand = candidate ?? {};
  const requiredSet = new Set(req.requiredFields ?? []);

  const conflicts: string[] = [];
  const verifiedMatches: string[] = [];
  const unverifiedFields: string[] = [];

  // 1. Asset class: motor vehicle vs accessory (e.g., EV charger)
  if (req.assetClass && cand.assetClass) {
    if (req.assetClass !== cand.assetClass) {
      conflicts.push(
        cand.assetClass === 'accessory'
          ? 'Accessory listing (not a motor vehicle) cannot match a vehicle request.'
          : 'Motor vehicle listing cannot match a vehicle accessory request.'
      );
    } else if (req.assetClass === 'accessory') {
      verifiedMatches.push('Vehicle accessory / equipment classification matches');
    }
  } else if (req.vehicleType && cand.assetClass === 'accessory') {
    conflicts.push(
      `Accessory listing cannot match a ${getVehicleTypeLabel(req.vehicleType, true)} request.`
    );
  } else if (cand.vehicleType && req.assetClass === 'accessory') {
    conflicts.push(
      `Vehicle listing (${getVehicleTypeLabel(cand.vehicleType, true)}) cannot match an accessory request.`
    );
  }

  // 2. Vehicle sub-type (passenger vs pickup vs commercial van/truck vs bus vs semi-tractor)
  if (req.vehicleType && cand.vehicleType) {
    if (req.vehicleType !== cand.vehicleType) {
      conflicts.push(
        `Vehicle type differs: requires ${getVehicleTypeLabel(req.vehicleType, true)}, found ${getVehicleTypeLabel(cand.vehicleType, true)}.`
      );
    } else {
      verifiedMatches.push(`Vehicle type matches (${getVehicleTypeLabel(cand.vehicleType, true)})`);
    }
  } else if (req.vehicleType && !cand.vehicleType && cand.assetClass !== 'accessory') {
    unverifiedFields.push(
      `Vehicle type not specified on listing (${getVehicleTypeLabel(req.vehicleType, true)} requested)`
    );
  } else if (!req.vehicleType && cand.vehicleType) {
    unverifiedFields.push(`Vehicle type (${getVehicleTypeLabel(cand.vehicleType, true)}) — verify fit`);
  }

  // 3. Condition (new vs used)
  if (req.condition && cand.condition) {
    if (req.condition !== cand.condition) {
      conflicts.push(
        `Condition differs: requires ${req.condition === 'new' ? 'New' : 'Used'}, found ${cand.condition === 'new' ? 'New' : 'Used'}.`
      );
    } else {
      verifiedMatches.push(`Condition matches (${cand.condition === 'new' ? 'New' : 'Used'})`);
    }
  } else if (req.condition && !cand.condition) {
    unverifiedFields.push(`New/used condition not specified (${req.condition} requested)`);
  } else if (!req.condition && cand.condition && mode === 'pool_comparison') {
    unverifiedFields.push(`Condition is ${cand.condition} — not specified in your search`);
  }

  // 4. Make (strict normalized comparison — never fuzzy-overridden)
  const reqMake = normalizeTokenText(req.make);
  const candMake = normalizeTokenText(cand.make);
  if (reqMake && candMake) {
    if (reqMake !== candMake) {
      conflicts.push(`Make differs: requires ${req.make}, found ${cand.make}.`);
    } else {
      verifiedMatches.push(`Make matches (${cand.make})`);
    }
  } else if (reqMake && !candMake) {
    unverifiedFields.push(`Make not specified (${req.make} requested)`);
  }

  // 5. Model (strict normalized token inclusion/equality — never fuzzy-overridden)
  const reqModel = normalizeTokenText(req.model);
  const candModel = normalizeTokenText(cand.model);
  if (reqModel && candModel) {
    const exactOrSub =
      reqModel === candModel ||
      candModel.startsWith(`${reqModel} `) ||
      reqModel.startsWith(`${candModel} `);
    if (!exactOrSub) {
      conflicts.push(`Model differs: requires ${req.model}, found ${cand.model}.`);
    } else {
      verifiedMatches.push(`Model matches (${cand.model})`);
    }
  } else if (reqModel && !candModel) {
    unverifiedFields.push(`Model not specified (${req.model} requested)`);
  }

  // 6. Model year / accepted year range
  const reqYears = getYearRange(req);
  const candYears = getYearRange(cand);
  if (reqYears && candYears) {
    const overlaps = reqYears[0] <= candYears[1] && candYears[0] <= reqYears[1];
    if (!overlaps) {
      conflicts.push(
        `Model year differs (${formatYearRequirement(cand)} vs ${formatYearRequirement(req)}) — requires ${formatYearRequirement(req)}, found ${formatYearRequirement(cand)}.`
      );
    } else {
      verifiedMatches.push(`Model year compatible (${formatYearRequirement(cand)})`);
    }
  } else if (reqYears && !candYears) {
    unverifiedFields.push(`Model year not specified (${formatYearRequirement(req)} requested)`);
  } else if (!reqYears && candYears && mode === 'pool_comparison') {
    unverifiedFields.push(`Model year ${formatYearRequirement(cand)} — not specified in search`);
  }

  // 7. Trim / configuration
  const reqTrim = normalizeTokenText(req.trim);
  const candTrim = normalizeTokenText(cand.trim);
  if (reqTrim && candTrim) {
    const trimMatch =
      reqTrim === candTrim ||
      candTrim.split(' ').includes(reqTrim) ||
      reqTrim.split(' ').includes(candTrim);
    if (!trimMatch) {
      conflicts.push(`Trim differs: requires ${req.trim}, found ${cand.trim}.`);
    } else {
      verifiedMatches.push(`Trim matches (${cand.trim})`);
    }
  } else if (reqTrim && !candTrim) {
    unverifiedFields.push(`Trim not specified (${req.trim} requested)`);
  }

  // 8. Fuel / powertrain
  const reqPower = canonicalPowertrain(req.powertrain);
  const candPower = canonicalPowertrain(cand.powertrain);
  if (reqPower && candPower) {
    if (reqPower !== candPower) {
      conflicts.push(
        `Powertrain differs: requires ${req.powertrain}, found ${cand.powertrain}.`
      );
    } else {
      verifiedMatches.push(`Powertrain matches (${cand.powertrain})`);
    }
  } else if (reqPower && !candPower) {
    unverifiedFields.push(`Fuel/powertrain not specified (${req.powertrain} requested)`);
  }

  // 9. Drivetrain
  const reqDrive = canonicalDrivetrain(req.drivetrain);
  const candDrive = canonicalDrivetrain(cand.drivetrain);
  if (reqDrive && candDrive) {
    if (reqDrive !== candDrive) {
      conflicts.push(
        `Drivetrain differs: requires ${req.drivetrain}, found ${cand.drivetrain}.`
      );
    } else {
      verifiedMatches.push(`Drivetrain matches (${cand.drivetrain})`);
    }
  } else if (reqDrive && !candDrive) {
    unverifiedFields.push(`Drivetrain not specified (${req.drivetrain} requested)`);
  }

  // 10. Transmission (only conflict when both specified and clearly incompatible)
  const reqTrans = normalizeTokenText(req.transmission);
  const candTrans = normalizeTokenText(cand.transmission);
  if (reqTrans && candTrans) {
    const transKind = (s: string) => {
      if (/\b(amt|automated\s*manual)\b/.test(s)) return 'amt';
      if (/\b(manual|stick)\b/.test(s)) return 'manual';
      if (/\b(cvt|automatic|auto)\b/.test(s)) return 'automatic';
      if (/\b(single\s*speed|direct\s*drive)\b/.test(s)) return 'single_speed';
      return s;
    };
    if (transKind(reqTrans) !== transKind(candTrans)) {
      conflicts.push(`Transmission differs: requires ${req.transmission}, found ${cand.transmission}.`);
    } else {
      verifiedMatches.push(`Transmission matches (${cand.transmission})`);
    }
  } else if (reqTrans && !candTrans && (mode === 'quote_review' || requiredSet.has('transmission'))) {
    unverifiedFields.push(`Transmission not specified (${req.transmission} requested)`);
  }

  // 11. Commercial truck / semi-tractor specs: axle, cab/sleeper, body config, trailer inclusion
  const reqAxle = canonicalAxle(req.axleConfiguration);
  const candAxle = canonicalAxle(cand.axleConfiguration);
  if (reqAxle && candAxle) {
    if (reqAxle !== candAxle) {
      conflicts.push(
        `Axle configuration differs: requires ${req.axleConfiguration}, found ${cand.axleConfiguration}.`
      );
    } else {
      verifiedMatches.push(`Axle configuration matches (${cand.axleConfiguration})`);
    }
  } else if (reqAxle && !candAxle) {
    unverifiedFields.push(`Axle configuration not specified (${req.axleConfiguration} requested)`);
  }

  const reqCab = canonicalCab(req.cabOrSleeper);
  const candCab = canonicalCab(cand.cabOrSleeper);
  if (reqCab && candCab) {
    if (reqCab !== candCab) {
      conflicts.push(`Cab/sleeper differs: requires ${req.cabOrSleeper}, found ${cand.cabOrSleeper}.`);
    } else {
      verifiedMatches.push(`Cab/sleeper matches (${cand.cabOrSleeper})`);
    }
  } else if (reqCab && !candCab) {
    unverifiedFields.push(`Cab/sleeper not specified (${req.cabOrSleeper} requested)`);
  }

  const reqBody = canonicalBodyConfig(req.bodyConfiguration);
  const candBody = canonicalBodyConfig(cand.bodyConfiguration);
  if (reqBody && candBody) {
    if (reqBody !== candBody) {
      conflicts.push(
        `Body configuration differs: requires ${req.bodyConfiguration}, found ${cand.bodyConfiguration}.`
      );
    } else {
      verifiedMatches.push(`Body configuration matches (${cand.bodyConfiguration})`);
    }
  } else if (reqBody && !candBody && (mode === 'quote_review' || requiredSet.has('bodyConfiguration'))) {
    unverifiedFields.push(`Body configuration not specified (${req.bodyConfiguration} requested)`);
  }

  if (req.trailerInclusion && cand.trailerInclusion) {
    if (req.trailerInclusion !== cand.trailerInclusion) {
      conflicts.push(
        req.trailerInclusion === 'includes_trailer'
          ? 'Trailer mismatch: request requires a trailer included, but listing/quote is tractor unit only.'
          : 'Trailer mismatch: request is for tractor unit only, while listing/quote includes a trailer.'
      );
    } else {
      verifiedMatches.push(
        cand.trailerInclusion === 'includes_trailer'
          ? 'Trailer inclusion matches (trailer included)'
          : 'Tractor unit only (trailer not included)'
      );
    }
  } else if (req.trailerInclusion === 'includes_trailer' && !cand.trailerInclusion) {
    if (mode === 'quote_review') {
      conflicts.push(
        'Trailer inclusion missing from quote: pool requires trailer included, and trailer is not confirmed in quote.'
      );
    } else {
      unverifiedFields.push('Trailer inclusion not specified — verify whether trailer is included');
    }
  }

  // 12. Weight / capacity specs (convert lbs <-> kg ONLY when both provide numeric values + explicit units)
  const checkMinCapacity = (
    reqVal: MeasuredValue<WeightUnit> | undefined,
    candVal: MeasuredValue<WeightUnit> | undefined,
    label: string,
    fieldKey: string
  ) => {
    const rLbs = toLbs(reqVal);
    const cLbs = toLbs(candVal);
    if (rLbs !== null && cLbs !== null) {
      // Allow tiny rounding tolerance across lbs/kg conversions (1%)
      if (cLbs < rLbs * 0.99) {
        conflicts.push(
          `${label} below requirement: needs ${formatMeasuredValue(reqVal)}, found ${formatMeasuredValue(candVal)}.`
        );
      } else {
        verifiedMatches.push(`${label} meets requirement (${formatMeasuredValue(candVal)})`);
      }
    } else if (rLbs !== null && cLbs === null && (mode === 'quote_review' || requiredSet.has(fieldKey))) {
      unverifiedFields.push(`${label} not specified (${formatMeasuredValue(reqVal)} requested)`);
    }
  };

  checkMinCapacity(req.gvwr, cand.gvwr, 'GVWR', 'gvwr');
  checkMinCapacity(req.gcwr, cand.gcwr, 'GCWR', 'gcwr');
  checkMinCapacity(req.payloadCapacity, cand.payloadCapacity, 'Payload capacity', 'payloadCapacity');
  checkMinCapacity(req.towingCapacity, cand.towingCapacity, 'Towing capacity', 'towingCapacity');

  // 13. Bus specifications (bus type, seating capacity, accessibility/ADA)
  const reqBus = canonicalBusType(req.busType);
  const candBus = canonicalBusType(cand.busType);
  if (reqBus && candBus) {
    if (reqBus !== candBus) {
      conflicts.push(`Bus type differs: requires ${req.busType}, found ${cand.busType}.`);
    } else {
      verifiedMatches.push(`Bus type matches (${cand.busType})`);
    }
  } else if (reqBus && !candBus) {
    unverifiedFields.push(`Bus type not specified (${req.busType} requested)`);
  }

  if (req.seatingCapacity !== undefined && cand.seatingCapacity !== undefined) {
    if (cand.seatingCapacity < req.seatingCapacity) {
      conflicts.push(
        `Seating capacity below requirement: needs at least ${req.seatingCapacity} passengers, found ${cand.seatingCapacity}.`
      );
    } else if (
      mode === 'pool_comparison' &&
      Math.abs(cand.seatingCapacity - req.seatingCapacity) > 6
    ) {
      conflicts.push(
        `Bus seating capacity differs significantly: requested ${req.seatingCapacity} passengers vs ${cand.seatingCapacity}.`
      );
    } else {
      verifiedMatches.push(`Seating capacity compatible (${cand.seatingCapacity} passengers)`);
    }
  } else if (req.seatingCapacity !== undefined && cand.seatingCapacity === undefined) {
    unverifiedFields.push(
      `Seating capacity not specified (${req.seatingCapacity} passengers requested)`
    );
  }

  const reqAda = canonicalAda(req.accessibilityRequirement);
  const candAda = canonicalAda(cand.accessibilityRequirement);
  if (reqAda && candAda) {
    if (reqAda !== candAda) {
      conflicts.push(
        reqAda === 'ada_required'
          ? 'Accessibility mismatch: request requires ADA/wheelchair lift, but listing/quote is non-ADA.'
          : 'Accessibility mismatch: request is non-ADA, while listing/quote requires ADA wheelchair equipment.'
      );
    } else {
      verifiedMatches.push(
        candAda === 'ada_required' ? 'ADA accessibility requirement matches' : 'Standard non-ADA seating'
      );
    }
  } else if (reqAda === 'ada_required' && !candAda) {
    unverifiedFields.push('ADA / wheelchair lift accessibility not specified — verify before proceeding');
  }

  // 14. Used vehicle mileage limit (convert mi <-> km ONLY when both specified)
  const reqMaxMi = toMiles(req.maxMileage);
  const candMi = toMiles(cand.mileage ?? cand.maxMileage);
  if (reqMaxMi !== null && candMi !== null) {
    if (candMi > reqMaxMi * 1.01) {
      conflicts.push(
        `Mileage exceeds limit: max ${formatMeasuredValue(req.maxMileage)}, found ${formatMeasuredValue(cand.mileage ?? cand.maxMileage)}.`
      );
    } else {
      verifiedMatches.push(`Mileage within limit (${formatMeasuredValue(cand.mileage ?? cand.maxMileage)})`);
    }
  } else if (reqMaxMi !== null && candMi === null) {
    unverifiedFields.push(`Mileage not specified (max ${formatMeasuredValue(req.maxMileage)} requested)`);
  }

  if (conflicts.length > 0) {
    return {
      compatible: false,
      status: 'conflict',
      conflicts,
      verifiedMatches,
      unverifiedFields,
    };
  }

  if (unverifiedFields.length > 0 || verifiedMatches.length === 0) {
    return {
      compatible: true,
      status: 'possible_verify',
      conflicts: [],
      verifiedMatches,
      unverifiedFields,
    };
  }

  return {
    compatible: true,
    status: 'exact_fit',
    conflicts: [],
    verifiedMatches,
    unverifiedFields: [],
  };
}

/**
 * Evaluates a published dealer quote against a pool's required vehicle specs
 * using the exact same unified vehicle compatibility model.
 * Any mismatch against required pool specs is flagged clearly and never silently
 * presented as a compatible offer.
 */
export function evaluateQuoteCompatibility(
  pool: Pick<Pool, 'category' | 'title' | 'vehicleSpecs' | 'sharedRequirements'>,
  offer: Pick<SellerOffer, 'matchingScope' | 'quotedVehicle' | 'excludedItems' | 'includedItems'> | undefined
): VehicleCompatibilityReport {
  if (!offer || pool.category !== 'Vehicles') {
    return {
      compatible: true,
      status: 'exact_fit',
      conflicts: [],
      verifiedMatches: [],
      unverifiedFields: [],
    };
  }

  const poolSpecs = inferVehicleSignalsFromText(pool.title, pool.vehicleSpecs);
  const quoteText = [
    offer.matchingScope,
    ...(offer.includedItems ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  const quoteSpecs = inferVehicleSignalsFromText(quoteText, offer.quotedVehicle);

  // Check explicit exclusions in the quote (e.g., excluding trailer or ADA lift when pool requires it)
  const excludedJoined = (offer.excludedItems ?? []).join(' ').toLowerCase();
  if (/\btrailer\b/.test(excludedJoined) && !quoteSpecs.trailerInclusion) {
    quoteSpecs.trailerInclusion = 'tractor_only';
  }
  if (/\b(ada|wheelchair|lift)\b/.test(excludedJoined) && !quoteSpecs.accessibilityRequirement) {
    quoteSpecs.accessibilityRequirement = 'Non-ADA / no lift';
  }

  return evaluateVehicleCompatibility(poolSpecs, quoteSpecs, { mode: 'quote_review' });
}

// ============================================================================
// TALLY CERTIFIED BULK DEALS & PAID FEATURED PLACEMENT RANKING
// Order applied ONLY AFTER user filters and eligibility:
//   1. Paid Featured (Sponsored · Featured) — if also Tally Certified, stays here and displays BOTH badges
//   2. Tally Certified bulk deal
//   3. Ordinary organic eligible listings
// Unavailable (unlocked/expired/closed) or filtered-out/incompatible listings NEVER get elevated.
// ============================================================================

export type PlacementTier = 'paid_featured' | 'tally_certified' | 'organic';

export function isPoolAvailableForBoostedPlacement(
  pool: Pick<Pool, 'stage'> & { metrics?: Pick<PoolMetrics, 'effectiveStage'> }
): boolean {
  const stage = pool.metrics?.effectiveStage ?? pool.stage;
  return (
    stage === 'gathering' ||
    stage === 'ready_for_quote' ||
    stage === 'quote_requested' ||
    stage === 'offer_open'
  );
}

export function getPoolPlacementInfo(
  pool: Pick<Pool, 'stage' | 'tallyCertification' | 'paidPlacement'> & {
    metrics?: Pick<PoolMetrics, 'effectiveStage'>;
  }
): {
  isPaidFeatured: boolean;
  isTallyCertified: boolean;
  hasBothBadges: boolean;
  eligibleForBoost: boolean;
  effectiveTier: PlacementTier;
} {
  const isPaidFeatured = pool.paidPlacement?.paidFeatured === true;
  const isTallyCertified = pool.tallyCertification?.certified === true;
  const eligibleForBoost = isPoolAvailableForBoostedPlacement(pool);

  let effectiveTier: PlacementTier = 'organic';
  if (eligibleForBoost) {
    if (isPaidFeatured) {
      effectiveTier = 'paid_featured';
    } else if (isTallyCertified) {
      effectiveTier = 'tally_certified';
    }
  }

  return {
    isPaidFeatured,
    isTallyCertified,
    hasBothBadges: isPaidFeatured && isTallyCertified,
    eligibleForBoost,
    effectiveTier,
  };
}

function tierRankValue(tier: PlacementTier): number {
  switch (tier) {
    case 'paid_featured':
      return 2;
    case 'tally_certified':
      return 1;
    case 'organic':
      return 0;
  }
}

export interface DiscoveryRankingResult<TPool extends Pool> {
  orderedPools: TPool[];
  paidCount: number;
  certifiedCount: number;
  organicCount: number;
  hasAnyBoosted: boolean;
}

/**
 * Ranks an ALREADY-FILTERED set of Explore pools according to Tally placement policy:
 *   Paid Featured > Tally Certified > Ordinary organic.
 *
 * Safeguards:
 * - Never elevates unavailable (unlocked, expired, closed) pools above active pools.
 * - When `matchKindByPoolId` is supplied (typed search), exact text matches ALWAYS remain
 *   above approximate text matches so a paid/certified approximate guess never outranks an
 *   exact organic match.
 * - Preserves relative order within each tier (stable sort).
 */
export function rankDiscoveryPools<
  TPool extends Pool & { metrics?: Pick<PoolMetrics, 'effectiveStage'> }
>(
  filteredPools: TPool[],
  options?: {
    matchKindByPoolId?: ReadonlyMap<string, 'all' | 'exact' | 'approximate'>;
  }
): DiscoveryRankingResult<TPool> {
  const indexed = filteredPools.map((pool, index) => {
    const info = getPoolPlacementInfo(pool);
    const matchKind = options?.matchKindByPoolId?.get(pool.id) ?? 'all';
    const exactRank = matchKind === 'exact' ? 2 : matchKind === 'all' ? 1 : 0;
    return { pool, index, info, exactRank };
  });

  indexed.sort((a, b) => {
    // 1. During typed search, exact text match ALWAYS beats approximate text match
    if (a.exactRank !== b.exactRank) {
      return b.exactRank - a.exactRank;
    }
    // 2. Placement tier among eligible listings: Paid Featured (2) > Tally Certified (1) > Organic (0)
    const tierDiff = tierRankValue(b.info.effectiveTier) - tierRankValue(a.info.effectiveTier);
    if (tierDiff !== 0) {
      return tierDiff;
    }
    // 3. Preserve original order within the same tier
    return a.index - b.index;
  });

  let paidCount = 0;
  let certifiedCount = 0;
  let organicCount = 0;
  for (const item of indexed) {
    if (item.info.effectiveTier === 'paid_featured') paidCount += 1;
    else if (item.info.effectiveTier === 'tally_certified') certifiedCount += 1;
    else organicCount += 1;
  }

  return {
    orderedPools: indexed.map((i) => i.pool),
    paidCount,
    certifiedCount,
    organicCount,
    hasAnyBoosted: paidCount > 0 || certifiedCount > 0,
  };
}

/**
 * Validates and normalizes itemized quote fees, distinguishing explicit $0 from unknown/TBD fees.
 */
export function normalizeQuoteItemizedFees(
  rawFees: unknown
): { valid: boolean; error?: string; items?: QuoteFeeItem[]; fixedTotal: number; hasUnknown: boolean } {
  if (rawFees === undefined || rawFees === null) {
    return { valid: true, items: undefined, fixedTotal: 0, hasUnknown: false };
  }
  if (!Array.isArray(rawFees)) {
    return { valid: false, error: 'Itemized fees must be a list.', fixedTotal: 0, hasUnknown: false };
  }

  const items: QuoteFeeItem[] = [];
  let fixedTotal = 0;
  let hasUnknown = false;

  for (const entry of rawFees.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as { label?: unknown; amount?: unknown; status?: unknown };
    const label = cleanStr(obj.label, 80);
    if (!label) continue;
    const status = obj.status === 'unknown' ? 'unknown' : 'fixed';
    if (status === 'unknown') {
      hasUnknown = true;
      items.push({ label, amount: null, status: 'unknown' });
    } else {
      const amount = Number(obj.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 500000) {
        return {
          valid: false,
          error: `Fee "${label}" must be $0 or a positive dollar amount (or marked Unknown / TBD).`,
          fixedTotal: 0,
          hasUnknown: false,
        };
      }
      const rounded = Math.round(amount * 100) / 100;
      fixedTotal += rounded;
      items.push({ label, amount: rounded, status: 'fixed' });
    }
  }

  return {
    valid: true,
    items: items.length > 0 ? items : undefined,
    fixedTotal: Math.round(fixedTotal * 100) / 100,
    hasUnknown,
  };
}

export function buildTrustedTallyCertification(
  managedBy: 'tally_seed' | 'tally_demo_admin',
  partnerDealerLabel?: string,
  customSummary?: string
): TallyCertificationMeta {
  return {
    certified: true,
    label: 'Tally Certified bulk deal',
    partnerDealerLabel: cleanStr(partnerDealerLabel, 100),
    summary:
      cleanStr(customSummary, 240) ||
      'Tally coordinated this bulk deal directly with a participating dealer for qualifying buyers.',
    disclaimer: TALLY_CERTIFIED_DISCLAIMER,
    managedBy,
    isDemoExample: true,
  };
}

export function buildTrustedPaidPlacement(
  managedBy: 'tally_seed' | 'tally_demo_admin',
  sponsorName?: string
): PaidPlacementMeta {
  return {
    paidFeatured: true,
    label: 'Sponsored · Featured',
    sponsorName: cleanStr(sponsorName, 100) || 'Fictional Demo Sponsor',
    managedBy,
    isDemoExample: true,
  };
}
