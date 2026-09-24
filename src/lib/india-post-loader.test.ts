// Round 3 — pure transform, no DB. Fixture CSV text only.

import { describe, expect, it } from "vitest";
import { groupIndiaPostRows, normalizeLocalityName, parseIndiaPostCsv } from "./india-post-loader";

const SAMPLE_CSV = `OFFICENAME,TALUK,DISTRICTNAME,STATENAME,PINCODE,OFFICETYPE,DELIVERYSTATUS,DIVISIONNAME,REGIONNAME,CIRCLENAME
Kukatpally S.O,Kukatpally,Hyderabad,TELANGANA,500072,S.O,Delivery,Hyderabad West,Hyderabad,Telangana
Kukatpally Housing Board Colony B.O,Kukatpally,Hyderabad,TELANGANA,500072,B.O,Delivery,Hyderabad West,Hyderabad,Telangana
Warangal H.O,Warangal,Warangal,TELANGANA,506002,H.O,Delivery,Warangal,Warangal,Telangana
Hanamkonda S.O,Warangal,Warangal,TELANGANA,506001,S.O,Delivery,Warangal,Warangal,Telangana
"Koramangala, Bangalore S.O",Bangalore South,Bangalore,KARNATAKA,560034,S.O,Delivery,Bangalore South,Bangalore,Karnataka
,Kukatpally,Hyderabad,TELANGANA,500072,S.O,Delivery,Hyderabad West,Hyderabad,Telangana
`;

describe("parseIndiaPostCsv", () => {
  it("parses rows by header name, case-insensitively, regardless of column order", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(5); // the blank-officename row is skipped
    expect(rows[0]).toEqual({
      officeName: "Kukatpally S.O",
      taluk: "Kukatpally",
      districtName: "Hyderabad",
      stateName: "TELANGANA",
      pincode: "500072",
    });
  });

  it("handles a quoted field containing a comma", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    const bangalore = rows.find((r) => r.officeName.includes("Koramangala"));
    expect(bangalore?.officeName).toBe("Koramangala, Bangalore S.O");
    expect(bangalore?.pincode).toBe("560034");
  });

  it("skips a row with a blank required field instead of throwing", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    expect(rows.every((r) => r.officeName.length > 0)).toBe(true);
  });

  it("falls back taluk to the district when the taluk column is empty", () => {
    const csv = `OFFICENAME,TALUK,DISTRICTNAME,STATENAME,PINCODE\nSomewhere S.O,,SomeDistrict,SomeState,123456\n`;
    const rows = parseIndiaPostCsv(csv);
    expect(rows[0].taluk).toBe("SomeDistrict");
  });

  it("throws when a required column is missing entirely", () => {
    const badCsv = `OFFICENAME,DISTRICTNAME,STATENAME,PINCODE\nX,Y,Z,123456\n`;
    expect(() => parseIndiaPostCsv(badCsv)).toThrow(/taluk/);
  });

  it("returns an empty array for an empty or header-only file", () => {
    expect(parseIndiaPostCsv("")).toEqual([]);
    expect(parseIndiaPostCsv("OFFICENAME,TALUK,DISTRICTNAME,STATENAME,PINCODE\n")).toEqual([]);
  });
});

describe("normalizeLocalityName", () => {
  it("strips the office-type suffix", () => {
    expect(normalizeLocalityName("Kukatpally S.O")).toBe("Kukatpally");
    expect(normalizeLocalityName("Kukatpally Housing Board Colony B.O")).toBe("Kukatpally Housing Board Colony");
    expect(normalizeLocalityName("Warangal H.O")).toBe("Warangal");
  });

  it("also strips the suffix without periods", () => {
    expect(normalizeLocalityName("Ameerpet SO")).toBe("Ameerpet");
  });

  it("leaves a name with no recognized suffix untouched", () => {
    expect(normalizeLocalityName("Some Odd Name")).toBe("Some Odd Name");
  });
});

describe("groupIndiaPostRows", () => {
  it("dedupes two post offices in the same taluk that normalize to the same name", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    const grouped = groupIndiaPostRows(rows);
    const kukatpally = grouped.filter((g) => g.localityName === "Kukatpally");
    expect(kukatpally).toHaveLength(1);
  });

  it("keeps genuinely different localities within the same taluk separate", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    const grouped = groupIndiaPostRows(rows);
    const warangalTaluk = grouped.filter((g) => g.taluk === "Warangal");
    expect(warangalTaluk.map((g) => g.localityName).sort()).toEqual(["Hanamkonda", "Warangal"]);
  });

  it("keeps the same locality name separate across different districts", () => {
    const csv = `OFFICENAME,TALUK,DISTRICTNAME,STATENAME,PINCODE
Gandhi Nagar S.O,Central,CityA,StateA,111111
Gandhi Nagar S.O,Central,CityB,StateA,222222
`;
    const grouped = groupIndiaPostRows(parseIndiaPostCsv(csv));
    expect(grouped).toHaveLength(2);
    expect(grouped.map((g) => g.districtName).sort()).toEqual(["CityA", "CityB"]);
  });

  it("keeps the first pincode seen for a deduped locality", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    const grouped = groupIndiaPostRows(rows);
    const kukatpally = grouped.find((g) => g.localityName === "Kukatpally");
    expect(kukatpally?.pincode).toBe("500072");
  });

  it("is idempotent: grouping the same rows twice produces the same result", () => {
    const rows = parseIndiaPostCsv(SAMPLE_CSV);
    const first = groupIndiaPostRows(rows);
    const second = groupIndiaPostRows(rows);
    expect(second).toEqual(first);
  });
});
