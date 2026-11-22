import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Package, Truck } from 'lucide-react';
import type { VehicleSpecProfile } from '../domain/types.ts';
import {
  formatMeasuredValue,
  formatTrailerInclusion,
  formatYearRequirement,
  getVehicleTypeLabel,
} from '../domain/vehicleEngine.ts';

interface VehicleSpecsDisplayProps {
  specs: VehicleSpecProfile | undefined;
  title?: string;
  compact?: boolean;
}

interface SpecRow {
  key: string;
  label: string;
  value: string;
  isUnknown?: boolean;
  isWarning?: boolean;
}

export function VehicleSpecsDisplay({ specs, title, compact = false }: VehicleSpecsDisplayProps) {
  if (!specs) {
    return (
      <div className="rounded-[6px] border border-[#E5E0D5] bg-[#FBF9F4] p-3.5 text-xs text-[#526059]">
        <p className="font-semibold text-[#152B23]">Vehicle specifications</p>
        <p className="mt-1">
          No structured vehicle attributes were recorded on this legacy listing. Verify exact make,
          model, year, condition, and equipment directly with the organizer before joining.
        </p>
      </div>
    );
  }

  if (specs.assetClass === 'accessory') {
    return (
      <div
        className="rounded-[6px] border border-[#DDD7C8] bg-[#FBF9F4] p-3.5"
        data-testid="vehicle-accessory-notice"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-[#152B23]">
          <Package className="h-4 w-4 text-[#1E4334]" aria-hidden="true" />
          <span>Vehicle accessory / equipment (not a motor vehicle)</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[#526059]">
          This listing is grouped under Vehicles for discovery, but it is charging/accessory
          equipment and will not match motor vehicle searches or vehicle type filters.
        </p>
      </div>
    );
  }

  const requiredSet = new Set(specs.requiredFields ?? []);
  const yearLabel = formatYearRequirement(specs);
  const trailerText = formatTrailerInclusion(specs.trailerInclusion, specs.vehicleType);

  const isCommercialTruck =
    specs.vehicleType === 'commercial_van_truck' ||
    specs.vehicleType === 'semi_tractor' ||
    specs.vehicleType === 'pickup';
  const isBus = specs.vehicleType === 'bus';
  const isUsed = specs.condition === 'used';

  const allRows: SpecRow[] = [
    {
      key: 'vehicleType',
      label: 'Vehicle type',
      value: specs.vehicleType ? getVehicleTypeLabel(specs.vehicleType, true) : 'Not specified',
      isUnknown: !specs.vehicleType,
    },
    {
      key: 'condition',
      label: 'Condition',
      value:
        specs.condition === 'new'
          ? 'New'
          : specs.condition === 'used'
            ? 'Used'
            : 'Not specified',
      isUnknown: !specs.condition,
    },
    {
      key: 'make',
      label: 'Make',
      value: specs.make || 'Not specified',
      isUnknown: !specs.make,
    },
    {
      key: 'model',
      label: 'Model',
      value: specs.model || 'Not specified',
      isUnknown: !specs.model,
    },
    {
      key: 'year',
      label: specs.yearMin && specs.yearMax && specs.yearMin !== specs.yearMax ? 'Accepted model years' : 'Model year',
      value: yearLabel || 'Not specified',
      isUnknown: !yearLabel,
    },
    {
      key: 'trim',
      label: 'Trim / configuration',
      value: specs.trim || 'Not specified',
      isUnknown: !specs.trim,
    },
    {
      key: 'powertrain',
      label: 'Fuel / powertrain',
      value: specs.powertrain || 'Not specified',
      isUnknown: !specs.powertrain,
    },
    {
      key: 'drivetrain',
      label: 'Drivetrain',
      value: specs.drivetrain || 'Not specified',
      isUnknown: !specs.drivetrain,
    },
    {
      key: 'transmission',
      label: 'Transmission',
      value: specs.transmission || 'Not specified',
      isUnknown: !specs.transmission,
    },
  ];

  if (isCommercialTruck || specs.bodyConfiguration || specs.axleConfiguration || specs.cabOrSleeper || specs.gvwr || specs.gcwr || specs.payloadCapacity || specs.towingCapacity || specs.trailerInclusion) {
    if (specs.bodyConfiguration) {
      allRows.push({ key: 'bodyConfiguration', label: 'Body / configuration', value: specs.bodyConfiguration });
    }
    if (specs.axleConfiguration) {
      allRows.push({ key: 'axleConfiguration', label: 'Axle configuration', value: specs.axleConfiguration });
    }
    if (specs.cabOrSleeper) {
      allRows.push({ key: 'cabOrSleeper', label: 'Cab / sleeper', value: specs.cabOrSleeper });
    }
    const gvwrStr = formatMeasuredValue(specs.gvwr);
    if (gvwrStr) allRows.push({ key: 'gvwr', label: 'GVWR (stated)', value: gvwrStr });
    const gcwrStr = formatMeasuredValue(specs.gcwr);
    if (gcwrStr) allRows.push({ key: 'gcwr', label: 'GCWR (stated)', value: gcwrStr });
    const payloadStr = formatMeasuredValue(specs.payloadCapacity);
    if (payloadStr) allRows.push({ key: 'payloadCapacity', label: 'Payload (stated)', value: payloadStr });
    const towingStr = formatMeasuredValue(specs.towingCapacity);
    if (towingStr) allRows.push({ key: 'towingCapacity', label: 'Towing (stated)', value: towingStr });
    if (trailerText) {
      allRows.push({
        key: 'trailerInclusion',
        label: 'Trailer inclusion',
        value: trailerText,
        isWarning: specs.trailerInclusion !== 'includes_trailer',
      });
    }
  }

  if (isBus || specs.busType || specs.seatingCapacity !== undefined || specs.accessibilityRequirement) {
    allRows.push({
      key: 'busType',
      label: 'Bus type',
      value: specs.busType || 'Not specified',
      isUnknown: !specs.busType,
    });
    allRows.push({
      key: 'seatingCapacity',
      label: 'Seating capacity',
      value:
        specs.seatingCapacity !== undefined
          ? `${specs.seatingCapacity} passengers`
          : 'Not specified',
      isUnknown: specs.seatingCapacity === undefined,
    });
    allRows.push({
      key: 'accessibilityRequirement',
      label: 'Accessibility / ADA',
      value: specs.accessibilityRequirement || 'Not specified',
      isUnknown: !specs.accessibilityRequirement,
    });
  }

  if (isUsed || specs.maxMileage || specs.mileage || specs.usedConditionNote) {
    const mileVal = formatMeasuredValue(specs.mileage ?? specs.maxMileage);
    allRows.push({
      key: 'maxMileage',
      label: specs.mileage ? 'Mileage' : 'Max mileage',
      value: mileVal || 'Not specified',
      isUnknown: !mileVal,
    });
    if (specs.usedConditionNote) {
      allRows.push({
        key: 'usedConditionNote',
        label: 'Used condition notes',
        value: specs.usedConditionNote,
      });
    }
  }

  if (specs.deliveryOrFleetNotes) {
    allRows.push({
      key: 'deliveryOrFleetNotes',
      label: 'Delivery & fleet notes',
      value: specs.deliveryOrFleetNotes,
    });
  }

  const visibleRows = compact ? allRows.filter((r) => !r.isUnknown).slice(0, 8) : allRows;

  return (
    <div
      className="rounded-[6px] border border-[#E5E0D5] bg-[#FBF9F4] p-4"
      data-testid="vehicle-specs-display"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#EAE5DA]">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-[#1E4334]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[#152B23]">
            {title || 'Structured vehicle specifications'}
          </h3>
        </div>
        {requiredSet.size > 0 && !compact && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#526059]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#1E4334]" aria-hidden="true" />
            <span>Required group specs marked</span>
          </span>
        )}
      </div>

      {specs.vehicleType === 'semi_tractor' && specs.trailerInclusion !== 'includes_trailer' && (
        <div className="mt-3 flex items-start gap-2 rounded-[5px] border border-[#E6C57A] bg-[#FFF8E6] px-3 py-2 text-xs text-[#734A08]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B47009]" aria-hidden="true" />
          <span>
            <strong>Tractor unit only:</strong> Semi-trailer is{' '}
            {specs.trailerInclusion === 'tractor_only' ? 'explicitly excluded' : 'not specified as included'}
            . Confirm separately if a trailer is needed.
          </span>
        </div>
      )}

      <dl className={`mt-3 grid gap-2.5 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {visibleRows.map((row) => {
          const isReq = requiredSet.has(row.key);
          return (
            <div
              key={row.key}
              className="rounded-[4px] border border-[#EFECE4] bg-white px-2.5 py-2"
            >
              <dt className="flex items-center justify-between gap-1 text-[10px] font-mono uppercase tracking-[0.06em] text-[#6B7872]">
                <span>{row.label}</span>
                {!compact && isReq && !row.isUnknown && (
                  <span className="rounded-[3px] bg-[#E8F1EC] px-1.5 py-0.5 text-[9px] font-bold text-[#1E4334]">
                    Required
                  </span>
                )}
                {!compact && !isReq && !row.isUnknown && requiredSet.size > 0 && (
                  <span className="rounded-[3px] bg-[#F5F2EB] px-1.5 py-0.5 text-[9px] text-[#6B7872]">
                    Pref
                  </span>
                )}
              </dt>
              <dd
                className={`mt-0.5 text-xs ${
                  row.isWarning
                    ? 'font-semibold text-[#8A5406]'
                    : row.isUnknown
                      ? 'italic text-[#88948E]'
                      : 'font-medium text-[#152B23]'
                }`}
              >
                {row.value}
              </dd>
            </div>
          );
        })}
      </dl>

      {!compact && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#6B7872]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Specifications above are buyer-entered group criteria. Tally does not verify OEM build
            sheets, legal DOT weight-class compliance, or towing/payload certifications — confirm
            exact VIN and build sheet directly with the dealer.
          </span>
        </p>
      )}
    </div>
  );
}
