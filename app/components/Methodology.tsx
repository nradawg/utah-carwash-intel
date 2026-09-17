"use client";
import type { Manifest } from "@/lib/data";

/**
 * Manifest text is written by the pipeline and can carry a spaced hyphen or
 * an en or em dash. Show it without them, the same as the rest of the page.
 */
const tidy = (t: string) =>
  String(t ?? "")
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)|\b(\d{4})-(\d{4})\b/g,
      (_, a, b, y1, y2) => `${a ?? y1} to ${b ?? y2}`)
    .replace(/\s+[-\u2013\u2014]\s+|[\u2013\u2014]/g, ", ")
    .replace(/\bODbL\b/g, "Open Database License")
    .replace(/,\s*SGID\b/g, "");

/**
 * Source names in the manifest are the publishers' own ("UGRC LIR parcels",
 * "UDOT AADT 2024"), which mean nothing to someone outside the trade. Match
 * each to a plain title and what the tool uses it for. Anything unmatched
 * falls back to the manifest name, so a new source still shows.
 */
const PLAIN_SOURCES: [RegExp, string, string][] = [
  [/\bLIR\b|UGRC.*parcel/i, "Utah county tax records",
    "Every commercial lot: its size, land value and whether it has a building. Collected statewide by the Utah Geospatial Resource Center."],
  [/AADT|traffic/i, "Utah Department of Transportation traffic counts",
    "About how many cars drive past each lot on an average day."],
  [/\bACS\b|American Community/i, "Census neighborhood survey (American Community Survey)",
    "Household income and cars per household near each lot."],
  [/OpenStreetMap/i, "OpenStreetMap",
    "Existing car washes, added and checked by volunteer mappers."],
  [/Overture/i, "Overture Maps places",
    "Existing car washes from business listings."],
  [/address point/i, "Utah address points",
    "Counting the homes near each lot."],
  [/FEMA|NFHL|flood/i, "FEMA flood maps",
    "Checking whether a lot is in a mapped flood zone."],
  [/permit/i, "Census building permits",
    "How many new homes are being built in each county."],
  [/population estimates.*count/i, "Census population estimates for counties",
    "County population in 2025 and growth since 2020."],
  [/population estimates.*(cit|town)/i, "Census population estimates for cities and towns",
    "How fast each town has grown since 2020."],
  [/municipal|city limit/i, "Utah city limits",
    "Which town each lot is in."],
];

function plainSource(name: string): { title: string; use: string | null } {
  const hit = PLAIN_SOURCES.find(([re]) => re.test(name));
  return hit ? { title: hit[1], use: hit[2] } : { title: tidy(name), use: null };
}

/** "2026-09-17T06:46Z" as "September 17, 2026" in Utah time. */
function updated(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US",
    { month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-[0.14em] mt-7 mb-2.5" style={{ color: "var(--ink-3)" }}>
      {children}
    </h3>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--ink-2)" }}>{children}</p>;
}

/** Opens in a new tab, so the map keeps its place. */
function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline"
      style={{ color: "var(--accent)" }}>{children}</a>
  );
}

/**
 * UGRC asks that republished data carries its disclaimer unmodified. Copied
 * word for word from https://gis.utah.gov/documentation/policy/license/ (the
 * same text is in DATA_LICENSES.md).
 */
const UGRC_DISCLAIMER = "The data, including but not limited to geographic data, tabular data, and analytical data, are provided “as is” and “as available”, with no guarantees relating to the availability, completeness, or accuracy of data, and without any express or implied warranties. These data are provided as a public service for informational purposes only. You are solely responsible for obtaining the proper evaluation of a location and associated data by a qualified professional. UGRC reserves the right to change, revise, suspend or discontinue published data and services without notice at any time. Neither UGRC nor the State of Utah are responsible for any misuse or misrepresentation of the data. UGRC and the State of Utah are not obligated to provide you with any maintenance or support. The user assumes the entire risk as to the quality and performance of the data. You agree to hold the State of Utah harmless for any claims, liability, costs, and damages relating to your use of the data. You agree that your sole remedy for any dissatisfaction or claims is to discontinue use of the data.";

const DATA_LICENSES_URL = "https://github.com/nradawg/utah-carwash-intel/blob/main/DATA_LICENSES.md";

function LicenceItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="py-2.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <div className="text-[12.5px]" style={{ color: "var(--ink)" }}>{title}</div>
      <div className="text-[12px] mt-0.5 leading-relaxed space-y-1.5" style={{ color: "var(--ink-2)" }}>
        {children}
      </div>
    </li>
  );
}

export default function Methodology({ m }: { m: Manifest }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain" style={{ background: "var(--panel)" }}>
      <div className="max-w-3xl px-4 md:px-6 py-6">
        <h2 className="text-[15px] font-semibold mb-2" style={{ color: "var(--ink)" }}>How to read this map</h2>
        <ul className="mb-2 space-y-2">
          {[
            "Each filled dot is a commercial lot from county tax records, at least half an acre, scored for how well it could work as a car wash. It is not a listing, and the lot is not necessarily for sale.",
            "Each ringed dot is a car wash that already exists. The ring color shows what kind it is.",
            "Scores run from 0 to 100. 70 and up is a Strong spot, 58 to 69 is Good, 48 to 57 is Fair, and under 48 is Weak.",
            "A score blends five things: competition nearby, homes nearby, traffic, the road and the lot, and growth. Growth looks at how fast the town grew since 2020, new homes permitted per 1,000 people in the county, the traffic trend, and whether the lot is empty. Counting homes per 1,000 people keeps big counties from looking fast just because they are big. The filters let you change how much each one counts. By default the list also skips lots that already hold a sizable business (buildings valued at $400,000 or more, or 10,000 sq ft or more) and lots the county has since split, merged or renumbered. Both can be switched off under Filters.",
            "Land values are what the county uses for property tax. Asking prices are usually higher.",
            "Tap a lot to see why it scored the way it did. Its panel links to a satellite photo, Street View, the county record and the Utah parcel map, so you can see the lot for yourself and look up who owns it with the county.",
            "Tap a ringed dot to see what kind of car wash it is, how sure the tool is about that, and a link to it on Google Maps.",
            "On a phone, the back button closes an open lot or car wash and takes you back to where you were.",
          ].map((t, i) => (
            <li key={i} className="text-[12px] leading-relaxed pl-4 relative" style={{ color: "var(--ink-2)" }}>
              <span className="absolute left-0" style={{ color: "var(--accent)" }}>•</span>{t}
            </li>
          ))}
        </ul>

        <h2 className="text-[15px] font-semibold mt-7 mb-1" style={{ color: "var(--ink)" }}>Where the numbers come from</h2>
        <p className="text-[12px] mb-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Every number here comes from a public source listed below. When something is a best
          guess, the tool says so. When data is missing, it says that too, instead of filling
          the gap. Data last updated {updated(m.generated)}.
        </p>

        <Heading>Sources</Heading>
        <ul className="mb-2">
          {m.sources.map(s => {
            const p = plainSource(s.name);
            return (
              <li key={s.name} className="py-2.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <a href={s.url} target="_blank" rel="noopener noreferrer"
                  className="text-[12.5px] underline" style={{ color: "var(--accent)" }}>{p.title}</a>
                {p.use && (
                  <div className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "var(--ink-2)" }}>{p.use}</div>
                )}
                <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--ink-3)" }}>
                  Covers: {/^(live|current)$/i.test(s.vintage) ? "kept up to date" : tidy(s.vintage)}.
                  {" "}Licence: {s.licence_url
                    ? <Ext href={s.licence_url}>{tidy(s.licence)}</Ext>
                    : tidy(s.licence)}.
                </div>
              </li>
            );
          })}
        </ul>

        <Heading>Data licences</Heading>
        <Para>
          The data behind this map is free to use and share, as long as the credits and
          licences below go with it. Every file and what was changed is listed in{" "}
          <Ext href={DATA_LICENSES_URL}>DATA_LICENSES.md on GitHub</Ext>.
        </Para>
        <ul className="mb-2">
          <LicenceItem title="Utah Geospatial Resource Center (UGRC)">
            <p>
              County tax records, address points, roads, city limits and county lines, from
              the State Geographic Information Database (SGID). Licence:{" "}
              <Ext href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0 (CC BY 4.0)</Ext>,
              as set out on <Ext href="https://gis.utah.gov/documentation/policy/license/">UGRC&apos;s licence page</Ext>.
            </p>
            <p>Credit: UGRC SGID (data modified).</p>
            <p>
              What was changed: tax records were narrowed to commercial lots of at least half an
              acre and joined with the other sources, roads were simplified, address points were
              counted into a grid, drive areas were worked out from the roads, and a few city
              records with the wrong Census code were corrected.
            </p>
            <p style={{ color: "var(--ink-3)" }}>UGRC disclaimer, in UGRC&apos;s own words:</p>
            <blockquote className="pl-3 text-[11.5px] leading-relaxed"
              style={{ borderLeft: "2px solid var(--line)", color: "var(--ink-3)" }}>
              {UGRC_DISCLAIMER}
            </blockquote>
          </LicenceItem>
          <LicenceItem title="OpenStreetMap">
            <p>
              Car washes added by volunteer mappers. © OpenStreetMap contributors. Licence:{" "}
              <Ext href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License (ODbL)</Ext>.
              If you share a changed copy of the car wash data, it has to be shared under the
              same licence. <Ext href="https://www.openstreetmap.org/copyright">How to credit OpenStreetMap</Ext>.
            </p>
          </LicenceItem>
          <LicenceItem title="Overture Maps Foundation">
            <p>
              Car washes from business listings. Licence:{" "}
              <Ext href="https://cdla.dev/permissive-2-0/">CDLA Permissive 2.0</Ext>, with the
              exceptions on <Ext href="https://docs.overturemaps.org/attribution/">Overture&apos;s attribution page</Ext>.
              Places from AllThePlaces are{" "}
              <Ext href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</Ext>, free of conditions.
            </p>
          </LicenceItem>
          <LicenceItem title="Foursquare places, through Overture Maps">
            <p>
              Some of the Overture car washes come from Foursquare under the Apache License 2.0.
              Foursquare asks that its notice and the licence go with the data:{" "}
              <Ext href="./NOTICE-FOURSQUARE.txt">Foursquare notice</Ext> and{" "}
              <Ext href="./LICENSE-APACHE-2.0.txt">Apache License 2.0</Ext>.
            </p>
          </LicenceItem>
          <LicenceItem title="Map background">
            <p>
              Drawn by <Ext href="https://openfreemap.org/">OpenFreeMap</Ext>, ©{" "}
              <Ext href="https://openmaptiles.org/">OpenMapTiles</Ext>, with data from ©
              OpenStreetMap contributors. Tap the i button in the corner of the map to see all
              the map credits.
            </p>
          </LicenceItem>
        </ul>

        <Heading>Known limits</Heading>
        <ul className="mb-2 space-y-2">
          {m.coverage_caveats.map((c, i) => (
            <li key={i} className="text-[12px] leading-relaxed pl-4 relative" style={{ color: "var(--ink-2)" }}>
              <span className="absolute left-0" style={{ color: "var(--warn)" }}>•</span>{tidy(c)}
            </li>
          ))}
        </ul>

        <Heading>Why traffic counts for less</Heading>
        <Para>
          Most people picking a car wash site start with how many cars drive by. Industry
          research says that is a weak guide. A company that runs the sales systems at
          thousands of car washes reports that the number of passing cars tells you almost
          nothing about how well a wash will do. A market research firm that studies car wash
          sites found traffic explains only about 6% of the difference in how busy washes are.
          Retail Petroleum Consultants, using sales from the Southwest, found that a wash
          catches 1.7% of passing cars on a road with 10,000 cars a day but only 0.5% on a road
          with 80,000. Eight times the traffic does not bring eight times the customers.
        </Para>
        <Para>
          So traffic mostly works as a minimum: a lot needs enough cars going by, and past that,
          more traffic adds only a little. Easy access counts for more. The industry rule of
          thumb is that making drivers turn left across traffic costs 30 to 50% of visits,
          though that is a common belief rather than a proven study. Competition counts just as
          much, because the harm comes all at once: that same research firm saw sales drop
          sharply when a third tunnel wash opened within a mile.
        </Para>
        <Para>
          Homes nearby count for more than traffic because most express washes now run on
          monthly memberships. Mister Car Wash said 79% of its wash sales in the last three
          months of 2025 came from members. What matters is how many households close by could
          pay a monthly fee, not how many cars pass the door.
        </Para>

        <Heading>The blue drive areas</Heading>
        <Para>
          When you open a lot, blue shading shows about how far people can drive to it in 5 and
          10 minutes. Industry advice says a 10 minute drive is a better way to picture a
          wash&apos;s customers than a circle of 3 to 5 miles, because roads matter. A freeway
          brings people from far along it, while a mountain or a lake leaves part of a circle
          empty. You can see this in Salt Lake Valley, where the blue areas stretch north and
          south along I-15 and stay narrow east and west.
        </Para>
        <Para>
          The tool works these out itself from Utah&apos;s statewide road map, using each
          road&apos;s speed limit plus a little extra time for intersections and turns. Two
          things to keep in mind. They assume no traffic, so rush hour is slower. And they were
          worked out for points about 0.4 miles apart, so a lot may borrow the drive area of a
          nearby point. When that happens, the lot&apos;s panel says how far away that point is.
        </Para>

        <Heading>How the kind of car wash is worked out</Heading>
        <Para>
          Most map records do not say what kind of car wash a place is. The tool works it out
          using the most reliable clue it can find, in this order: a note from an OpenStreetMap
          volunteer, a match to a known Utah car wash brand (checked against each
          company&apos;s own website), the business category in its listing, and finally words in
          the business name. If none of those give an answer, it shows Format unknown instead of
          guessing. Tap any ringed dot to see which clue was used.
        </Para>
        <Para>
          Hand wash and detail shops, including mobile detailers, are shown on the map but not
          counted as competition, because they do not compete with a tunnel wash.
        </Para>
      </div>
    </div>
  );
}
