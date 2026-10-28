/**
 * Fixed wording that every report carries: equations, limitations, and the
 * register of references with their verification status.
 *
 * Nothing here is new information. Each list mirrors a project document and a
 * test (tests/report.test.ts) fails if the report and the document drift apart:
 *   EQUATIONS   ↔ docs/equations-and-assumptions.md, section 2
 *   REFERENCES  ↔ docs/sources.md, sections 1–3
 * Update the document and this file together. Do not add a reference here that
 * has not been added to docs/sources.md with its status.
 */

export interface EquationEntry {
  n: number;
  /** Exactly as written in docs/equations-and-assumptions.md. */
  expression: string;
  /** Plain-language reading, for the report. */
  meaning: string;
}

export const EQUATIONS: readonly EquationEntry[] = [
  { n: 1, expression: 'R = d / λ', meaning: 'Resistance of one homogeneous layer of thickness d and conductivity λ.' },
  { n: 2, expression: 'R_total = R_si + Σ(d_i / λ_i) + R_se', meaning: 'Resistances in series add: inside surface film, all layers, outside surface film.' },
  { n: 3, expression: 'U = 1 / R_total', meaning: 'Thermal transmittance of the whole assembly, including the surface films.' },
  { n: 4, expression: 'A = width × height', meaning: 'Wall area (the whole area is treated as one uniform wall).' },
  { n: 5, expression: 'Q̇ = U · A · |T_i − T_e|', meaning: 'Heat-transfer rate (magnitude only) for constant air temperatures.' },
  { n: 6, expression: 'direction = outward if T_i > T_e; inward if T_i < T_e; none if equal', meaning: 'Direction of heat flow, reported separately from the magnitude.' },
  { n: 7, expression: 'E = Q̇ · t / 1000', meaning: 'Energy transferred in t hours at constant conditions, in kWh. Not an annual demand.' },
  { n: 8, expression: 'C = Σ ρ_i · c_p,i · V_i, with V_i = A · d_i', meaning: 'Heat capacity of the wall: how much heat it stores per kelvin (a simple sum).' },
  { n: 9, expression: 'C_A = Σ ρ_i · c_p,i · d_i', meaning: 'Heat capacity per square metre of wall.' },
  { n: 10, expression: 'q_signed = (T_i − T_e) / R_total (positive = outward)', meaning: 'Steady heat flux; the same flux crosses every layer and surface film.' },
  { n: 11, expression: 'T_si = T_i − q·R_si', meaning: 'Temperature of the inside surface.' },
  { n: 12, expression: 'T after layer k = T_si − q · Σ_{j≤k} R_j', meaning: 'Temperature at each layer interface; linear inside each homogeneous layer.' },
  { n: 13, expression: 'T_se = T_e + q·R_se', meaning: 'Temperature of the outside surface.' },
];

/** Statements about scope. They appear in every report, whatever the data. */
export const LIMITATIONS: readonly string[] = [
  'Steady state only: constant inside and outside air temperatures, one-dimensional heat flow. This is not a dynamic or hourly simulation and not a whole-building energy simulation.',
  'The wall is treated as thermally homogeneous layers over its full area. Thermal bridges (studs, ties, mortar joints, fasteners), air cavities, windows, doors and ground contact are not modelled.',
  'Solar radiation, air leakage, ventilation, moisture and ageing are not modelled. Layer properties are used exactly as entered, with no correction for temperature or moisture; the conversion procedures of EN ISO 10456 are not implemented.',
  'The energy figure is power multiplied by a duration under constant conditions. It is not an annual energy demand and not a prediction of energy use.',
  'Heat capacity is a simple sum of density × specific heat × volume. It does not describe dynamic thermal response, which needs a transient model and boundary conditions.',
  'Measured, declared and design thermal values are different things. This program does not convert between them, and it does not decide which one a user should use.',
  'No result has been compared with any requirement of Cyprus legislation or of a standard. The report makes no claim of compliance with ISO 6946, EN ISO 10456 or any Cypriot regulation.',
  'Automated tests show that the code reproduces independent hand calculations of the stated equations for the stated cases. They are not a validation against measurements and not evidence that a design is acceptable.',
];

export interface StandardEntry {
  name: string;
  edition: string;
  role: string;
  status: string;
}

export interface LinkEntry {
  title: string;
  url: string;
  status: string;
}

export interface ReferenceRegister {
  hierarchy: readonly string[];
  standards: readonly StandardEntry[];
  /** Secondary sources that agree with the preset surface resistances. None is the standard itself. */
  surfaceResistanceSources: readonly LinkEntry[];
  /** Leads for material data. None has been read, so none supports any value. */
  materialDataLeads: readonly LinkEntry[];
}

export const REFERENCES: ReferenceRegister = {
  hierarchy: [
    'CYS EN ISO 6946 (the Cyprus adoption of EN ISO 6946): calculation method for thermal resistance and transmittance.',
    'EN ISO 10456: declared and design thermal values and conversion procedures.',
    'Applicable Cyprus building-energy legislation and official guidance: regulatory context only; no compliance is claimed.',
    'Manufacturer datasheets and published HTI / Brunel research: potential sources of material properties.',
    'SEAI material tables: supplementary reference data only.',
  ],
  standards: [
    {
      name: 'ISO 6946 Building components and building elements — Thermal resistance and thermal transmittance — Calculation methods',
      edition: 'ISO 6946:2017 found by catalogue search. The edition adopted in Cyprus (CYS EN ISO 6946) is unconfirmed.',
      role: 'Basis of the method: R = d/λ, R_total = R_si + ΣR + R_se, U = 1/R_total.',
      status: 'Standard text not read against this implementation. No compliance claimed.',
    },
    {
      name: 'EN ISO 10456 Building materials and products — Hygrothermal properties — Tabulated design values and procedures for determining declared and design thermal values',
      edition: 'EN ISO 10456:2007 + AC:2009 appears current. Not confirmed on ISO\'s site.',
      role: 'Distinction between declared and design values. Its conversion procedures are not implemented.',
      status: 'Not read. Not used in the calculation.',
    },
    {
      name: 'ISO 13786 Thermal performance of building components — Dynamic thermal characteristics — Calculation methods',
      edition: 'ISO 13786:2017.',
      role: 'Only relevant if a dynamic model is added later.',
      status: 'Not used.',
    },
  ],
  surfaceResistanceSources: [
    { title: 'Ravago Building Solutions knowledge base — heat transfer coefficient', url: 'https://ravagobuildingsolutions.com/hu/en/knowledgebase/heat-transfer-coefficient', status: 'Secondary source; agrees with the preset. Not the standard.' },
    { title: 'Forum post reproducing the ISO 6946 table', url: 'https://forum.edilclima.it/viewtopic.php?p=63126', status: 'Secondary source; agrees with the preset. Not the standard.' },
    { title: 'Data Driven AEC wall U-value calculator', url: 'https://datadrivenaec.com/tools/uvalue-calculator-wall-assembly', status: 'Secondary source; agrees with the preset. Not the standard.' },
  ],
  materialDataLeads: [
    { title: 'SEAI DEAP guide — thermal conductivity table', url: 'https://deapguide.seai.ie/fabric/heat-loss-u-value/thermal-conductivity', status: 'Lead only. Not read. Supports no value in this program.' },
    { title: 'HTI (Cyprus) diploma project on temperature and moisture effects on thermal conductivity', url: 'https://athena.cut.ac.cy/s/hti/item/235994', status: 'Lead only. Not read. Supports no value in this program.' },
    { title: 'Brunel University study on Cypriot building simulation', url: 'https://bura.brunel.ac.uk/handle/2438/7881', status: 'Lead only. Not read. Supports no value in this program.' },
  ],
};
