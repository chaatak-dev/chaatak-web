/**
 * Current conditions.
 *
 * Every number here came from the adapter and is printed exactly as upstream
 * sent it, with upstream's own unit beside it. The condition is rendered from
 * a template keyed on the source's weather code; an unmapped code prints as
 * the bare code rather than as a description we invented for it.
 */

import type { NoData, Reading } from '@/lib/weather/types';
import { MEASUREMENT_LABELS } from '@/lib/weather/labels';
import { conditionFor } from '@/lib/weather/wmo';
import { NoDataField } from './NoDataField';
import { Provenance } from './Provenance';

function Condition({ code }: { code: number | null }) {
  if (code === null) {
    return (
      <>
        <h2 lang="hi" className="current__headline current__headline--absent">
          स्थिति नहीं दी गई
        </h2>
        <p className="current__subtitle">Condition not given by the source.</p>
      </>
    );
  }

  const template = conditionFor(code);
  if (!template) {
    // Honest about the gap: the source said something we have no words for.
    return (
      <>
        <h2 lang="hi" className="current__headline current__headline--absent">
          कोड {code}
        </h2>
        <p className="current__subtitle">
          Code {code} — no description in the template table.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 lang="hi" className="current__headline">
        {template.hi}
      </h2>
      <p className="current__subtitle">{template.en}</p>
    </>
  );
}

export function CurrentConditions({
  reading,
  timeZone,
}: {
  reading: Reading | NoData;
  timeZone: string;
}) {
  if (reading.kind === 'noData') {
    return <NoDataField state={reading} timeZone={timeZone} />;
  }

  const temperature = reading.measurements.find((m) => m.key === 'temperature');
  const rest = reading.measurements.filter((m) => m.key !== 'temperature');

  return (
    <section className="current" aria-labelledby="current-heading">
      <p className="section-label" id="current-heading">
        <span lang="hi" className="section-label__hi">
          अभी
        </span>
        <span className="section-label__en">Now</span>
      </p>

      <Condition code={reading.conditionCode} />

      {temperature && (
        <p className="current__temp">
          <span className="current__temp-value">{temperature.value}</span>
          <span className="current__temp-unit">{temperature.unit}</span>
        </p>
      )}

      <dl className="current__grid">
        {rest.map((m) => {
          const label = MEASUREMENT_LABELS[m.key];
          return (
            <div className="current__cell" key={m.key}>
              <dt className="current__cell-label">
                <span lang="hi">{label.hi}</span>
                <span className="current__cell-label-en">{label.en}</span>
              </dt>
              <dd className="current__cell-value">
                {m.value}
                <span className="current__cell-unit">{m.unit}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      <Provenance
        source={reading.provenance.source}
        nature={reading.provenance.nature}
        timestamp={reading.provenance.issuedAt}
        basis={reading.provenance.timeBasis}
        timeZone={timeZone}
        severity="none"
      />
    </section>
  );
}
