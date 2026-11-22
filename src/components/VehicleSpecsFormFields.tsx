import React from 'react';
import { AlertTriangle, CheckSquare, Package, Square, Truck } from 'lucide-react';
import type { StartPoolDraftState } from '../domain/startPoolDraft.ts';
import type {
  DistanceUnit,
  TrailerInclusion,
  VehicleCondition,
  VehicleSpecProfile,
  VehicleSubType,
  WeightUnit,
} from '../domain/types.ts';
import { VEHICLE_TYPE_LIST } from '../domain/vehicleEngine.ts';

const POWERTRAIN_PRESETS = ['Gas', 'Hybrid', 'Plug-in Hybrid (PHEV)', 'Electric (BEV)', 'Diesel', 'CNG / Propane'];
const DRIVETRAIN_PRESETS = ['AWD', '4WD / 4x4', 'FWD', 'RWD', '6x4', '6x2', '4x2'];
const TRANSMISSION_PRESETS = ['Automatic', 'CVT Automatic', 'AMT (Automated Manual)', 'Manual', 'Single-Speed (EV)'];
const AXLE_PRESETS = ['4x2', '4x4', '6x4', '6x2', '8x4'];
const BUS_TYPE_PRESETS = ['Shuttle bus', 'Minibus', 'Transit bus', 'School bus', 'Motorcoach'];

/**
 * Converts persisted StartPoolDraftState vehicle fields into a clean structured VehicleSpecProfile.
 * Unspecified fields stay undefined (never invented).
 */
export function buildVehicleSpecProfileFromDraft(
  draft: StartPoolDraftState
): VehicleSpecProfile {
  if (draft.vehAssetClass === 'accessory') {
    return { assetClass: 'accessory' };
  }

  const profile: VehicleSpecProfile = {
    assetClass: 'vehicle',
  };

  if (draft.vehType) profile.vehicleType = draft.vehType;
  if (draft.vehCondition) profile.condition = draft.vehCondition;
  if (draft.vehMake.trim()) profile.make = draft.vehMake.trim();
  if (draft.vehModelName.trim()) profile.model = draft.vehModelName.trim();
  if (draft.vehTrim.trim()) profile.trim = draft.vehTrim.trim();

  if (draft.vehYearMode === 'range') {
    if (draft.vehYearMin.trim()) profile.yearMin = Number(draft.vehYearMin.trim());
    if (draft.vehYearMax.trim()) profile.yearMax = Number(draft.vehYearMax.trim());
  } else if (draft.vehYear.trim()) {
    profile.year = Number(draft.vehYear.trim());
  }

  if (draft.vehPowertrain.trim()) profile.powertrain = draft.vehPowertrain.trim();
  if (draft.vehTransmission.trim()) profile.transmission = draft.vehTransmission.trim();
  if (draft.vehDrivetrain.trim()) profile.drivetrain = draft.vehDrivetrain.trim();

  const isTruckLike =
    draft.vehType === 'pickup' ||
    draft.vehType === 'commercial_van_truck' ||
    draft.vehType === 'semi_tractor';
  const isBus = draft.vehType === 'bus';

  if (isTruckLike || draft.vehBodyConfig.trim()) {
    if (draft.vehBodyConfig.trim()) profile.bodyConfiguration = draft.vehBodyConfig.trim();
    if (draft.vehAxleConfig.trim()) profile.axleConfiguration = draft.vehAxleConfig.trim();
    if (draft.vehCabOrSleeper.trim()) profile.cabOrSleeper = draft.vehCabOrSleeper.trim();
    if (draft.vehGvwrValue.trim()) {
      profile.gvwr = { value: Number(draft.vehGvwrValue.trim()), unit: draft.vehGvwrUnit };
    }
    if (draft.vehGcwrValue.trim()) {
      profile.gcwr = { value: Number(draft.vehGcwrValue.trim()), unit: draft.vehGcwrUnit };
    }
    if (draft.vehPayloadValue.trim()) {
      profile.payloadCapacity = {
        value: Number(draft.vehPayloadValue.trim()),
        unit: draft.vehPayloadUnit,
      };
    }
    if (draft.vehTowingValue.trim()) {
      profile.towingCapacity = {
        value: Number(draft.vehTowingValue.trim()),
        unit: draft.vehTowingUnit,
      };
    }
    if (draft.vehType === 'semi_tractor' && draft.vehTrailerInclusion) {
      profile.trailerInclusion = draft.vehTrailerInclusion;
    }
  }

  if (isBus) {
    if (draft.vehBusType.trim()) profile.busType = draft.vehBusType.trim();
    if (draft.vehSeatingCapacity.trim()) {
      profile.seatingCapacity = Number(draft.vehSeatingCapacity.trim());
    }
    if (draft.vehAccessibility.trim()) {
      profile.accessibilityRequirement = draft.vehAccessibility.trim();
    }
    if (draft.vehGvwrValue.trim()) {
      profile.gvwr = { value: Number(draft.vehGvwrValue.trim()), unit: draft.vehGvwrUnit };
    }
  }

  if (draft.vehCondition === 'used') {
    if (draft.vehMaxMileageValue.trim()) {
      profile.maxMileage = {
        value: Number(draft.vehMaxMileageValue.trim()),
        unit: draft.vehMaxMileageUnit,
      };
    }
    if (draft.vehUsedConditionNote.trim()) {
      profile.usedConditionNote = draft.vehUsedConditionNote.trim();
    }
  }

  if (draft.vehDeliveryFleetNotes.trim()) {
    profile.deliveryOrFleetNotes = draft.vehDeliveryFleetNotes.trim();
  }

  if (Array.isArray(draft.vehRequiredFields) && draft.vehRequiredFields.length > 0) {
    profile.requiredFields = draft.vehRequiredFields;
  }

  return profile;
}

interface VehicleSpecsFormFieldsProps {
  draft: StartPoolDraftState;
  updateField: <K extends keyof StartPoolDraftState>(key: K, value: StartPoolDraftState[K]) => void;
  fieldErrors: Record<string, string>;
}

export function VehicleSpecsFormFields({
  draft,
  updateField,
  fieldErrors,
}: VehicleSpecsFormFieldsProps) {
  const requiredSet = new Set(draft.vehRequiredFields ?? []);

  const toggleRequired = (fieldKey: string) => {
    const next = new Set(requiredSet);
    if (next.has(fieldKey)) {
      next.delete(fieldKey);
    } else {
      next.add(fieldKey);
    }
    updateField('vehRequiredFields', Array.from(next));
  };

  const RequiredToggle = ({ fieldKey, label }: { fieldKey: string; label: string }) => {
    const isReq = requiredSet.has(fieldKey);
    return (
      <button
        type="button"
        onClick={() => toggleRequired(fieldKey)}
        className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
          isReq
            ? 'bg-[#E8F1EC] text-[#1E4334] hover:bg-[#D7E8DF]'
            : 'bg-[#F3EFE6] text-[#6B7872] hover:bg-[#E8E2D4]'
        }`}
        aria-pressed={isReq}
        title={`Mark ${label} as required group spec vs preference`}
      >
        {isReq ? (
          <CheckSquare className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Square className="h-3 w-3" aria-hidden="true" />
        )}
        <span>{isReq ? 'Required' : 'Preference'}</span>
      </button>
    );
  };

  const isPickup = draft.vehType === 'pickup';
  const isCommercialTruck = draft.vehType === 'commercial_van_truck';
  const isBus = draft.vehType === 'bus';
  const isSemi = draft.vehType === 'semi_tractor';
  const showCommercialWeightBlock = isPickup || isCommercialTruck || isSemi;

  return (
    <div className="space-y-4 rounded-[8px] border border-[#DDD7C8] bg-[#FBF9F4] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#152B23]">
            Vehicle type &amp; structured specifications
          </h3>
          <p className="text-xs text-[#526059]">
            Fill only what matters for your group. Unspecified fields stay honestly unknown rather
            than assumed.
          </p>
        </div>
      </div>

      {/* Asset Class Toggle: Motor Vehicle vs Accessory */}
      <div>
        <span className="block text-[11px] font-mono uppercase tracking-[0.06em] text-[#526059]">
          What are you pooling?
        </span>
        <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => updateField('vehAssetClass', 'vehicle')}
            aria-pressed={draft.vehAssetClass === 'vehicle'}
            className={`tally-tactile flex items-center gap-2.5 rounded-[6px] border px-3 py-2.5 text-left text-xs ${
              draft.vehAssetClass === 'vehicle'
                ? 'border-[#1E4334] bg-[#1E4334] text-white'
                : 'border-[#DDD7C8] bg-white text-[#152B23] hover:border-[#1E4334]'
            }`}
          >
            <Truck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="block">Motor vehicle</strong>
              <span className={draft.vehAssetClass === 'vehicle' ? 'text-[#CBE0D5]' : 'text-[#526059]'}>
                Car, SUV, pickup, commercial truck, bus, or semi-tractor
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              updateField('vehAssetClass', 'accessory');
              updateField('vehType', '');
            }}
            aria-pressed={draft.vehAssetClass === 'accessory'}
            className={`tally-tactile flex items-center gap-2.5 rounded-[6px] border px-3 py-2.5 text-left text-xs ${
              draft.vehAssetClass === 'accessory'
                ? 'border-[#1E4334] bg-[#1E4334] text-white'
                : 'border-[#DDD7C8] bg-white text-[#152B23] hover:border-[#1E4334]'
            }`}
          >
            <Package className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="block">Vehicle accessory / equipment</strong>
              <span className={draft.vehAssetClass === 'accessory' ? 'text-[#CBE0D5]' : 'text-[#526059]'}>
                EV chargers, racks, tires, parts (not a motor vehicle)
              </span>
            </span>
          </button>
        </div>
      </div>

      {draft.vehAssetClass === 'accessory' ? (
        <div className="rounded-[6px] border border-[#DDD7C8] bg-white p-3 text-xs text-[#526059]">
          This pool will be classified as a <strong>Vehicle accessory / equipment</strong> listing.
          Use the title and shared requirements below for model/SKU details (e.g., 48A NACS EV
          charger).
        </div>
      ) : (
        <>
          {/* Vehicle Sub-Type Selector */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-mono uppercase tracking-[0.06em] text-[#526059]">
                Vehicle type
              </label>
              <RequiredToggle fieldKey="vehicleType" label="Vehicle type" />
            </div>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {VEHICLE_TYPE_LIST.map((vt) => {
                const selected = draft.vehType === vt.id;
                return (
                  <button
                    key={vt.id}
                    type="button"
                    onClick={() => updateField('vehType', vt.id as VehicleSubType)}
                    aria-pressed={selected}
                    className={`tally-tactile rounded-[6px] border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-[#1E4334] bg-[#E8F1EC] text-[#152B23]'
                        : 'border-[#DDD7C8] bg-white text-[#152B23] hover:border-[#1E4334]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold">{vt.shortLabel}</span>
                      {vt.commercial && (
                        <span className="rounded-[3px] bg-[#F5EFE2] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[#6B5426]">
                          Commercial
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#526059]">{vt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Common Vehicle Specs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-condition" className="text-xs font-medium text-[#152B23]">
                  New or used
                </label>
                <RequiredToggle fieldKey="condition" label="Condition" />
              </div>
              <select
                id="veh-condition"
                value={draft.vehCondition}
                onChange={(e) => updateField('vehCondition', e.target.value as VehicleCondition | '')}
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              >
                <option value="">Not specified (either / verify)</option>
                <option value="new">New</option>
                <option value="used">Used / pre-owned</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-make" className="text-xs font-medium text-[#152B23]">
                  Make
                </label>
                <RequiredToggle fieldKey="make" label="Make" />
              </div>
              <input
                id="veh-make"
                type="text"
                value={draft.vehMake}
                onChange={(e) => updateField('vehMake', e.target.value)}
                placeholder="e.g., Ford, Subaru, Isuzu, Freightliner, Blue Bird"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-model-name" className="text-xs font-medium text-[#152B23]">
                  Model
                </label>
                <RequiredToggle fieldKey="model" label="Model" />
              </div>
              <input
                id="veh-model-name"
                type="text"
                value={draft.vehModelName}
                onChange={(e) => updateField('vehModelName', e.target.value)}
                placeholder="e.g., Maverick, Outback, NPR-HD, Cascadia 126"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
            </div>

            {/* Model Year OR Explicitly Accepted Year Range */}
            <div className="sm:col-span-2 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#152B23]">Model year</span>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-[5px] border border-[#D4CEC1] bg-white p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => updateField('vehYearMode', 'single')}
                      className={`rounded-[4px] px-2 py-0.5 ${
                        draft.vehYearMode === 'single'
                          ? 'bg-[#1E4334] font-semibold text-white'
                          : 'text-[#526059]'
                      }`}
                    >
                      Single year
                    </button>
                    <button
                      type="button"
                      onClick={() => updateField('vehYearMode', 'range')}
                      className={`rounded-[4px] px-2 py-0.5 ${
                        draft.vehYearMode === 'range'
                          ? 'bg-[#1E4334] font-semibold text-white'
                          : 'text-[#526059]'
                      }`}
                    >
                      Accepted range
                    </button>
                  </div>
                  <RequiredToggle fieldKey="year" label="Model year" />
                </div>
              </div>
              {draft.vehYearMode === 'single' ? (
                <input
                  id="veh-year"
                  type="number"
                  min={1980}
                  max={2030}
                  value={draft.vehYear}
                  onChange={(e) => updateField('vehYear', e.target.value)}
                  placeholder="e.g., 2026 (leave blank if unspecified)"
                  className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                />
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input
                    id="veh-year-min"
                    type="number"
                    min={1980}
                    max={2030}
                    value={draft.vehYearMin}
                    onChange={(e) => updateField('vehYearMin', e.target.value)}
                    placeholder="From year (e.g., 2024)"
                    className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                  <input
                    id="veh-year-max"
                    type="number"
                    min={1980}
                    max={2030}
                    value={draft.vehYearMax}
                    onChange={(e) => updateField('vehYearMax', e.target.value)}
                    placeholder="To year (e.g., 2026)"
                    className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                </div>
              )}
              {(fieldErrors['vehicleSpecs.year'] ||
                fieldErrors['vehicleSpecs.yearMin'] ||
                fieldErrors['vehicleSpecs.yearMax']) && (
                <p className="mt-1 text-xs text-[#A3361F]">
                  {fieldErrors['vehicleSpecs.year'] ||
                    fieldErrors['vehicleSpecs.yearMin'] ||
                    fieldErrors['vehicleSpecs.yearMax']}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-trim" className="text-xs font-medium text-[#152B23]">
                  Trim / configuration
                </label>
                <RequiredToggle fieldKey="trim" label="Trim" />
              </div>
              <input
                id="veh-trim"
                type="text"
                value={draft.vehTrim}
                onChange={(e) => updateField('vehTrim', e.target.value)}
                placeholder="e.g., XLT, Touring XT, Aero Fleet"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-powertrain" className="text-xs font-medium text-[#152B23]">
                  Fuel / powertrain
                </label>
                <RequiredToggle fieldKey="powertrain" label="Powertrain" />
              </div>
              <input
                id="veh-powertrain"
                type="text"
                list="tally-powertrain-options"
                value={draft.vehPowertrain}
                onChange={(e) => updateField('vehPowertrain', e.target.value)}
                placeholder="Gas, Hybrid, Electric, Diesel, or custom"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
              <datalist id="tally-powertrain-options">
                {POWERTRAIN_PRESETS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-drivetrain" className="text-xs font-medium text-[#152B23]">
                  Drivetrain
                </label>
                <RequiredToggle fieldKey="drivetrain" label="Drivetrain" />
              </div>
              <input
                id="veh-drivetrain"
                type="text"
                list="tally-drivetrain-options"
                value={draft.vehDrivetrain}
                onChange={(e) => updateField('vehDrivetrain', e.target.value)}
                placeholder="AWD, 4WD, FWD, RWD, 6x4, or custom"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
              <datalist id="tally-drivetrain-options">
                {DRIVETRAIN_PRESETS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="veh-transmission" className="text-xs font-medium text-[#152B23]">
                  Transmission
                </label>
                <RequiredToggle fieldKey="transmission" label="Transmission" />
              </div>
              <input
                id="veh-transmission"
                type="text"
                list="tally-transmission-options"
                value={draft.vehTransmission}
                onChange={(e) => updateField('vehTransmission', e.target.value)}
                placeholder="Automatic, AMT, Manual, or custom"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
              <datalist id="tally-transmission-options">
                {TRANSMISSION_PRESETS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Commercial Truck / Pickup / Semi-Tractor Specifications */}
          {showCommercialWeightBlock && (
            <div className="space-y-3 rounded-[6px] border border-[#E5DEC9] bg-white p-3.5">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#1E4334]">
                  {isSemi
                    ? 'Semi-tractor / 18-wheeler specifications'
                    : isCommercialTruck
                      ? 'Commercial van / truck specifications'
                      : 'Pickup payload & towing specifications (optional)'}
                </h4>
                <p className="mt-0.5 text-[11px] text-[#526059]">
                  Enter explicit units (lbs or kg). Tally records your stated criteria and does not
                  certify DOT weight classes or OEM capacities.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(isCommercialTruck || isSemi) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-body-config" className="text-xs font-medium text-[#152B23]">
                        Body / configuration
                      </label>
                      <RequiredToggle fieldKey="bodyConfiguration" label="Body configuration" />
                    </div>
                    <input
                      id="veh-body-config"
                      type="text"
                      value={draft.vehBodyConfig}
                      onChange={(e) => updateField('vehBodyConfig', e.target.value)}
                      placeholder={isSemi ? 'Sleeper Semi-Tractor / Day Cab' : '16ft Box Truck, Cargo Van, Flatbed'}
                      className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                    />
                  </div>
                )}

                {(isCommercialTruck || isSemi) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-axle" className="text-xs font-medium text-[#152B23]">
                        Axle configuration
                      </label>
                      <RequiredToggle fieldKey="axleConfiguration" label="Axle configuration" />
                    </div>
                    <input
                      id="veh-axle"
                      type="text"
                      list="tally-axle-options"
                      value={draft.vehAxleConfig}
                      onChange={(e) => updateField('vehAxleConfig', e.target.value)}
                      placeholder="e.g., 6x4, 4x2, 6x2"
                      className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                    />
                    <datalist id="tally-axle-options">
                      {AXLE_PRESETS.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                )}

                {(isSemi || isCommercialTruck || isPickup) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-cab" className="text-xs font-medium text-[#152B23]">
                        Cab / sleeper
                      </label>
                      <RequiredToggle fieldKey="cabOrSleeper" label="Cab/sleeper" />
                    </div>
                    <input
                      id="veh-cab"
                      type="text"
                      value={draft.vehCabOrSleeper}
                      onChange={(e) => updateField('vehCabOrSleeper', e.target.value)}
                      placeholder={
                        isSemi ? '72" Raised Roof Sleeper or Day Cab' : 'Crew Cab, Regular Cab, High Roof'
                      }
                      className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                    />
                  </div>
                )}

                {/* GVWR */}
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="veh-gvwr" className="text-xs font-medium text-[#152B23]">
                      GVWR
                    </label>
                    <RequiredToggle fieldKey="gvwr" label="GVWR" />
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      id="veh-gvwr"
                      type="number"
                      min={1}
                      value={draft.vehGvwrValue}
                      onChange={(e) => updateField('vehGvwrValue', e.target.value)}
                      placeholder={isSemi ? '52000' : '14500'}
                      className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                    />
                    <select
                      aria-label="GVWR unit"
                      value={draft.vehGvwrUnit}
                      onChange={(e) => updateField('vehGvwrUnit', e.target.value as WeightUnit)}
                      className="rounded-[6px] border border-[#D4CEC1] bg-white px-2 py-2 text-xs font-mono text-[#152B23]"
                    >
                      <option value="lbs">lbs</option>
                      <option value="kg">kg</option>
                    </select>
                  </div>
                  {fieldErrors['vehicleSpecs.gvwr'] && (
                    <p className="mt-1 text-xs text-[#A3361F]">{fieldErrors['vehicleSpecs.gvwr']}</p>
                  )}
                </div>

                {/* GCWR (Semi & Commercial Truck) */}
                {(isSemi || isCommercialTruck) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-gcwr" className="text-xs font-medium text-[#152B23]">
                        GCWR
                      </label>
                      <RequiredToggle fieldKey="gcwr" label="GCWR" />
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        id="veh-gcwr"
                        type="number"
                        min={1}
                        value={draft.vehGcwrValue}
                        onChange={(e) => updateField('vehGcwrValue', e.target.value)}
                        placeholder="80000"
                        className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                      />
                      <select
                        aria-label="GCWR unit"
                        value={draft.vehGcwrUnit}
                        onChange={(e) => updateField('vehGcwrUnit', e.target.value as WeightUnit)}
                        className="rounded-[6px] border border-[#D4CEC1] bg-white px-2 py-2 text-xs font-mono text-[#152B23]"
                      >
                        <option value="lbs">lbs</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                    {fieldErrors['vehicleSpecs.gcwr'] && (
                      <p className="mt-1 text-xs text-[#A3361F]">{fieldErrors['vehicleSpecs.gcwr']}</p>
                    )}
                  </div>
                )}

                {/* Payload (Pickup & Commercial Truck) */}
                {(isPickup || isCommercialTruck) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-payload" className="text-xs font-medium text-[#152B23]">
                        Payload capacity
                      </label>
                      <RequiredToggle fieldKey="payloadCapacity" label="Payload capacity" />
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        id="veh-payload"
                        type="number"
                        min={1}
                        value={draft.vehPayloadValue}
                        onChange={(e) => updateField('vehPayloadValue', e.target.value)}
                        placeholder="e.g., 1500 or 8300"
                        className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                      />
                      <select
                        aria-label="Payload unit"
                        value={draft.vehPayloadUnit}
                        onChange={(e) => updateField('vehPayloadUnit', e.target.value as WeightUnit)}
                        className="rounded-[6px] border border-[#D4CEC1] bg-white px-2 py-2 text-xs font-mono text-[#152B23]"
                      >
                        <option value="lbs">lbs</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                    {fieldErrors['vehicleSpecs.payloadCapacity'] && (
                      <p className="mt-1 text-xs text-[#A3361F]">
                        {fieldErrors['vehicleSpecs.payloadCapacity']}
                      </p>
                    )}
                  </div>
                )}

                {/* Towing (Pickup & Commercial Truck) */}
                {(isPickup || isCommercialTruck) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="veh-towing" className="text-xs font-medium text-[#152B23]">
                        Towing capacity
                      </label>
                      <RequiredToggle fieldKey="towingCapacity" label="Towing capacity" />
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        id="veh-towing"
                        type="number"
                        min={1}
                        value={draft.vehTowingValue}
                        onChange={(e) => updateField('vehTowingValue', e.target.value)}
                        placeholder="e.g., 4000"
                        className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                      />
                      <select
                        aria-label="Towing unit"
                        value={draft.vehTowingUnit}
                        onChange={(e) => updateField('vehTowingUnit', e.target.value as WeightUnit)}
                        className="rounded-[6px] border border-[#D4CEC1] bg-white px-2 py-2 text-xs font-mono text-[#152B23]"
                      >
                        <option value="lbs">lbs</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                    {fieldErrors['vehicleSpecs.towingCapacity'] && (
                      <p className="mt-1 text-xs text-[#A3361F]">
                        {fieldErrors['vehicleSpecs.towingCapacity']}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Semi-Tractor Trailer Inclusion (explicitly never assume trailer included) */}
              {isSemi && (
                <div className="rounded-[6px] border border-[#E6C57A] bg-[#FFFDF7] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="veh-trailer" className="text-xs font-semibold text-[#152B23]">
                      Trailer inclusion (semi-tractor)
                    </label>
                    <RequiredToggle fieldKey="trailerInclusion" label="Trailer inclusion" />
                  </div>
                  <select
                    id="veh-trailer"
                    value={draft.vehTrailerInclusion}
                    onChange={(e) =>
                      updateField('vehTrailerInclusion', e.target.value as TrailerInclusion | '')
                    }
                    className="mt-1.5 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  >
                    <option value="">Not specified (buyers should NOT assume a trailer is included)</option>
                    <option value="tractor_only">Tractor unit only — trailer NOT included</option>
                    <option value="includes_trailer">Trailer explicitly included with tractor</option>
                  </select>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#734A08]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Semi-tractor pools default to tractor unit only unless a trailer is explicitly
                      selected and specified in the dealer quote.
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Bus Specifications */}
          {isBus && (
            <div className="space-y-3 rounded-[6px] border border-[#E5DEC9] bg-white p-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#1E4334]">
                Bus &amp; passenger transport specifications
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="veh-bus-type" className="text-xs font-medium text-[#152B23]">
                      Bus type
                    </label>
                    <RequiredToggle fieldKey="busType" label="Bus type" />
                  </div>
                  <input
                    id="veh-bus-type"
                    type="text"
                    list="tally-bus-type-options"
                    value={draft.vehBusType}
                    onChange={(e) => updateField('vehBusType', e.target.value)}
                    placeholder="Shuttle bus, Transit bus, School bus"
                    className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                  <datalist id="tally-bus-type-options">
                    {BUS_TYPE_PRESETS.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="veh-seating" className="text-xs font-medium text-[#152B23]">
                      Seating capacity (passengers)
                    </label>
                    <RequiredToggle fieldKey="seatingCapacity" label="Seating capacity" />
                  </div>
                  <input
                    id="veh-seating"
                    type="number"
                    min={4}
                    max={120}
                    value={draft.vehSeatingCapacity}
                    onChange={(e) => updateField('vehSeatingCapacity', e.target.value)}
                    placeholder="e.g., 24"
                    className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                  {fieldErrors['vehicleSpecs.seatingCapacity'] && (
                    <p className="mt-1 text-xs text-[#A3361F]">
                      {fieldErrors['vehicleSpecs.seatingCapacity']}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="veh-ada" className="text-xs font-medium text-[#152B23]">
                      Accessibility / ADA needs
                    </label>
                    <RequiredToggle fieldKey="accessibilityRequirement" label="Accessibility" />
                  </div>
                  <input
                    id="veh-ada"
                    type="text"
                    value={draft.vehAccessibility}
                    onChange={(e) => updateField('vehAccessibility', e.target.value)}
                    placeholder="e.g., ADA wheelchair lift (2 tie-downs)"
                    className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Used Vehicle Mileage & Condition Notes */}
          {draft.vehCondition === 'used' && (
            <div className="space-y-3 rounded-[6px] border border-[#E5DEC9] bg-white p-3.5">
              <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#1E4334]">
                Used vehicle mileage &amp; condition criteria
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="veh-max-mileage" className="text-xs font-medium text-[#152B23]">
                      Maximum mileage
                    </label>
                    <RequiredToggle fieldKey="maxMileage" label="Max mileage" />
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      id="veh-max-mileage"
                      type="number"
                      min={0}
                      value={draft.vehMaxMileageValue}
                      onChange={(e) => updateField('vehMaxMileageValue', e.target.value)}
                      placeholder="e.g., 45000"
                      className="w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                    />
                    <select
                      aria-label="Mileage unit"
                      value={draft.vehMaxMileageUnit}
                      onChange={(e) =>
                        updateField('vehMaxMileageUnit', e.target.value as DistanceUnit)
                      }
                      className="rounded-[6px] border border-[#D4CEC1] bg-white px-2 py-2 text-xs font-mono text-[#152B23]"
                    >
                      <option value="mi">mi</option>
                      <option value="km">km</option>
                    </select>
                  </div>
                  {fieldErrors['vehicleSpecs.maxMileage'] && (
                    <p className="mt-1 text-xs text-[#A3361F]">
                      {fieldErrors['vehicleSpecs.maxMileage']}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="veh-used-note" className="text-xs font-medium text-[#152B23]">
                    Condition / inspection notes
                  </label>
                  <input
                    id="veh-used-note"
                    type="text"
                    value={draft.vehUsedConditionNote}
                    onChange={(e) => updateField('vehUsedConditionNote', e.target.value)}
                    placeholder="e.g., Clean title, service records, DOT inspection required"
                    className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Optional Delivery / Fleet Notes */}
          {(isCommercialTruck || isBus || isSemi) && (
            <div>
              <label htmlFor="veh-fleet-notes" className="text-xs font-medium text-[#152B23]">
                Delivery, upfit, or fleet requirements (optional)
              </label>
              <input
                id="veh-fleet-notes"
                type="text"
                value={draft.vehDeliveryFleetNotes}
                onChange={(e) => updateField('vehDeliveryFleetNotes', e.target.value)}
                placeholder="e.g., Yard pickup, liftgate upfit timeline, buyer handles commercial plates"
                className="mt-1 w-full rounded-[6px] border border-[#D4CEC1] bg-white px-3 py-2 text-sm text-[#152B23]"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
