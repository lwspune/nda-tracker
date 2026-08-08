/**
 * NDA GAT chapter -> subtopic taxonomy.
 *
 * Generated from PYQ Vault (the content master), the same source
 * `src/lib/ndaSubtopics.js` is generated from for Maths. Join is by exact name.
 *
 * WHY THIS EXISTS. Every GAT subject in `NDA_FREQ_BY_SUBJECT` is an empty array,
 * so `getValidChapters` fell through to whatever `ndaFreqBySubject` had accreted
 * from past uploads. That list did not contain the chapters the tags files
 * actually use, and Step3Tags rendered chapter as a <select>: a value with no
 * matching <option> displays BLANK, so 95 of 150 correct chapters in one mock
 * showed as "needs tagging" and were overwritten with the nearest wrong option.
 * 193 questions across three mocks were repaired on 2026-08-08.
 *
 * This is empirical fact about the paper, not configuration — a plain module
 * constant. Not store state, not persisted, not in the student-login payload.
 */

export const NDA_GAT_TAXONOMY = {
  "English": {
    "Cloze Test": [
      "Word Selection in Passage",
    ],
    "Fill in the Blanks": [
      "Contextual Fill-in-Blank",
      "Contextual Word Selection (Phrasal Verbs and Collocations)",
    ],
    "Grammar": [
      "Active and Passive Voice",
      "Articles, Determiners and Quantifiers",
      "Correct Sentence Identification",
      "Direct and Indirect Speech",
      "Discourse Markers and Connectors",
      "Parts of Speech",
      "Preposition Usage",
      "Sentence Completion",
      "Subject-Verb Agreement",
    ],
    "Idioms and Phrases": [
      "Idiom Meaning",
    ],
    "Reading Comprehension": [
      "Inferential Comprehension",
      "Literal Comprehension",
      "Vocabulary in Context",
    ],
    "Sentence Rearrangement": [
      "Paragraph Sequencing (S1–S6)",
      "Sentence Part Rearrangement (PQRS)",
    ],
    "Spotting Errors": [
      "Articles, Determiners and Pronouns",
      "Correct Sentence Identification",
      "Mixed Error Detection",
      "No Error (Correct Sentence)",
      "Sentence Improvement",
      "Subject-Verb Agreement",
      "Tense and Verb Form",
      "Word Choice, Prepositions and Punctuation",
    ],
    "Vocabulary": [
      "Antonyms",
      "Confusable Word Pairs",
      "Synonyms",
      "Word Definition",
    ],
  },
  "Physics": {
    "Astronomy and Space": [
      "Astronomy and Space",
    ],
    "Electricity and Magnetism": [
      "Cells, EMF and Kirchhoff's Laws",
      "Combination of Resistors",
      "Electric Current and Ohm's Law",
      "Electrical Devices",
      "Electrical Power, Energy and Heating",
      "Electrostatics",
      "Magnetic Force and Fleming's Rules",
      "Magnetism and Magnetic Effects of Current",
      "Resistance and Resistivity",
    ],
    "Energy Sources": [
      "Energy Sources",
    ],
    "Fluid Mechanics and Properties of Matter": [
      "Buoyancy, Density and Flotation",
      "Pressure and Surface Tension",
    ],
    "Gravitation": [
      "Gravitational Field and Potential",
      "Newton's Law of Gravitation",
      "Orbits, Kepler and Escape",
    ],
    "Heat and Thermodynamics": [
      "Heat, Calorimetry and Specific Heat",
      "Phase Change and Boiling",
      "Temperature and Thermometry",
      "Thermodynamic Processes",
    ],
    "Kinematics and Motion": [
      "Circular Motion",
      "Equations of Motion and Graphs",
      "Projectile and Vertical Motion",
      "Vectors and Position",
    ],
    "Laws of Motion and Forces": [
      "Conservation of Momentum and Collisions",
      "Friction",
      "Impulse and Momentum",
      "Newton's Laws of Motion",
      "Types of Forces",
    ],
    "Light and Optics": [
      "Human Eye and Optical Instruments",
      "Lenses and Lens Formula",
      "Light Phenomena and Spectrum",
      "Prisms and Dispersion",
      "Reflection and Mirrors",
      "Refraction, Speed of Light and TIR",
    ],
    "Modern Physics": [
      "Atomic Structure",
      "Nuclear Physics",
      "Photoelectric Effect",
      "Quantum and Modern EM",
      "Scientific Acronyms",
      "Scientists and Discoveries",
    ],
    "Oscillations and Waves": [
      "Simple Harmonic Motion and General Waves",
      "Simple Pendulum",
    ],
    "Sound": [
      "Applications — SONAR, Transducers, Instruments",
      "Foundations — Sound, Perception, and the Ear",
      "Sound Behaviours — Reflection, Echo, Reverberation, Beats",
      "Wave Equation, Speed, and Frequency Bands",
    ],
    "Units, Measurement and Dimensions": [
      "Units and Dimensions",
    ],
    "Work, Energy and Power": [
      "Energy and Conservation",
      "Simple Machines",
      "Work and Work Done",
      "Work-Energy Theorem and Power",
    ],
  },
  "Chemistry": {
    "Acids, Bases and Salts": [
      "Acid-Base Theory: Concepts, Oxides and Electrolytes",
      "Common Acids: Names, Formulas and Uses",
      "Salts and Common Compounds",
      "Water of Crystallization",
      "pH Scale and Common Substances",
    ],
    "Atomic Structure and Periodic Classification": [
      "Atomic Models: Dalton, Rutherford, Bohr",
      "Atomic Number, Mass Number and Subatomic Particles",
      "Electron Configuration and Valence Shells",
      "Isotopes and Isoelectronic Species",
      "Periodic Trends, Valency and Atomicity",
    ],
    "Carbon and Its Compounds": [
      "Allotropes of Carbon",
      "Catenation, Tetra-valency and Isomerism",
      "Common Carbon Compounds and Pigments",
      "Functional Groups and Common Organic Compounds",
      "Hydrocarbons and Organic Classification",
      "Soaps, Detergents and Hydrogenation of Oils",
    ],
    "Chemical Bonding": [
      "Bond Counting and Molecular Structure",
      "Ionic and Covalent Bonding",
      "Valency, Oxidation States and Molecular Formula",
    ],
    "Chemical Reactions": [
      "Endothermic and Exothermic Reactions",
      "Physical vs Chemical Changes",
      "Redox: Oxidation, Reduction and Reducing Agents",
      "Specific Reactions: Precipitation, Electrolysis and Daily Life",
      "Thermal and Photochemical Decomposition",
      "Types of Reactions: Combination, Decomposition, Displacement",
    ],
    "Chemistry in Everyday Life": [
      "Common Chemicals and Their Uses",
      "Medicines and Health Chemistry",
    ],
    "Hydrogen and Water": [
      "Hardness and Purity of Water",
      "Properties and Anomalous Behaviour of Water",
      "Properties of Hydrogen",
    ],
    "Industrial and Applied Chemistry": [
      "Cement, Glass and Building Materials",
      "Common Industrial Substances and Alloys",
      "Fertilizers",
      "Industrial Gases, Manufacturing and Reactions",
      "Paints and Coatings",
    ],
    "Matter and Its States": [
      "Colloids and Suspensions",
      "Compounds, Mixtures and Solutions",
      "Physical vs Chemical Changes",
      "Separation Techniques",
      "States of Matter, Phase Changes and Diffusion",
    ],
    "Metals and Non-Metals": [
      "Alloys and Their Composition",
      "Corrosion and Its Prevention",
      "Extraction of Metals and Ores",
      "Reactivity Series and Reactions with Water",
    ],
    "Mole Concept and Stoichiometry": [
      "Mole Concept, Avogadro's Law and Molar Calculations",
      "Stoichiometry and Laws of Chemical Combination",
    ],
    "Practical Chemistry": [
      "Practical Applications: Health, Food and Lab Methods",
    ],
  },
  "Biology": {
    "Biochemistry": [
      "Anaerobic Respiration and Fermentation",
      "Food Spoilage — Rancidity and Browning",
      "Protein Structure",
    ],
    "Biodiversity and Classification": [
      "Animal Kingdom Classification",
      "Kingdom Fungi",
      "Plant Kingdom Classification",
    ],
    "Cell Biology": [
      "Cell Division and DNA Replication",
      "Cell Organelles and Functions",
      "Cell Structure Fundamentals",
      "Cell Wall and Cell Membrane",
      "Cellular Respiration and ATP",
      "Microscopy",
      "Osmosis and Tonicity",
      "Prokaryotic vs Eukaryotic Cells",
    ],
    "Ecology and Environment": [
      "Ecosystems, Biomes and Ecological Interactions",
      "Environment and Biodiversity",
    ],
    "Genetics and Evolution": [
      "Heredity and DNA",
      "Theory of Evolution",
    ],
    "Human Physiology": [
      "Circulatory and Lymphatic System",
      "Connective and Epithelial Tissues",
      "Digestive System and Enzymes",
      "Endocrine System and Hormones",
      "Excretory and Reproductive Anatomy",
      "Immune System — Antibody Production",
      "Nervous System and Sense Organs",
      "Nutrition, Vitamins and Minerals",
      "Respiratory System",
    ],
    "Microbiology and Disease": [
      "Antibiotics — Discovery",
      "Disease Vectors — Malaria",
      "Pathogens and Diseases",
    ],
    "Plant Biology": [
      "Photosynthesis",
      "Plant Tissues and Meristems",
      "Seed, Fruit and Embryo Development",
      "Transpiration, Tropisms and Plant Processes",
      "Vegetative Propagation",
    ],
    "Reproduction": [
      "Angiosperm Reproduction — Pollination and Fertilization",
      "Animal and Human Reproduction",
      "Meiosis and DNA in Flowering Plants",
      "Sexual Reproduction — Genetic Principles",
    ],
  },
  "Geography": {
    "Climatology, Atmosphere and Weather": [
      "Atmospheric Layers, Composition and Aurora",
      "Atmospheric Pressure and Winds",
      "Climate Classification and Zones",
      "Cyclones, Fronts and Local Winds",
      "Humidity, Condensation, Clouds and Precipitation",
      "Insolation, Temperature and Solar Geometry",
    ],
    "Earth in Space, Maps and Coordinates": [
      "Earth's Shape, Rotation and Motion",
      "Latitude, Longitude and Geographical Grid",
      "Maps and GPS",
      "Planets and Solar System",
      "Time Zones and International Date Line",
    ],
    "Earth's Structure, Landforms and Geological Time": [
      "Earth's Interior, Crust and Plate Tectonics",
      "Earthquakes and Seismic Waves",
      "Landforms and Mass Movements",
      "Rocks, Minerals and Geological Time",
      "Soils",
      "Volcanoes and Igneous Activity",
      "Weathering and Denudation",
    ],
    "Indian Geography — Economy, Resources and Transport": [
      "Agriculture, Crops, Soils and Land Use",
      "Economic Sectors and Government Schemes",
      "Energy and Industries — Power, Petroleum, Iron and Steel",
      "Highways, Railways and Transport Corridors",
      "Minerals and Mining",
      "Ports and Maritime Infrastructure",
    ],
    "Indian Geography — Physical Features": [
      "Forests and Natural Vegetation of India",
      "Indian Rivers, Lakes and Water Bodies",
      "Indian Soils and Climate-Agriculture",
      "Indian States and Islands",
      "Location, Extent and Frontiers of India",
      "Mountains, Plateaus and Plains of India",
    ],
    "Oceanography": [
      "Marine Ecosystems — Coral Reefs",
      "Ocean Currents",
      "Ocean Waves and Sea-Floor Topography",
      "Tides and Ocean Movements",
    ],
    "World and Human Geography": [
      "Human Geography — Megacities and Population",
      "World — Coordinates, Time and Place",
      "World — Rivers, Canals and Water Bodies",
    ],
  },
  "History": {
    "Ancient India": [
      "Ancient Indian Literature and Inscriptions",
      "Buddhism, Jainism and Religious Architecture",
      "Harappan and Indus Valley Civilization",
      "Mahajanapadas, Magadha and Mauryan Empire",
      "Post-Mauryan, Gupta and Sangam Period",
      "Society, Trade and Foreign Connections",
      "Vedic Age, Society and Literature",
    ],
    "Medieval India": [
      "Bhakti and Sufi Movements",
      "Medieval Literature and Texts",
      "Medieval Travellers, Trade and Crops",
      "Mughal Empire and Administration",
      "Other Medieval Kingdoms (Chola, Rajput, Ahom, Sikh)",
      "Vijayanagara Empire",
    ],
    "Modern India": [
      "19th Century Social and Religious Reform",
      "British Administration, Acts and Legislation",
      "British Economic Policy and Industrial India",
      "European Trading and Early British Conquest",
      "Freedom Movement — INC, Gandhi and Independence",
      "Post-Independence India",
    ],
    "World History": [
      "20th Century — World Wars, Modernity and Global Institutions",
      "Enlightenment and Political Revolutions",
      "Industrial Revolution",
      "Renaissance, Exploration and Scientific Revolution",
    ],
  },
  "Polity": {
    "Fundamental Rights, DPSP and Local Governance": [
      "Electoral Systems",
      "Fundamental Rights, DPSP and Duties",
      "Local Self-Government and Panchayati Raj",
    ],
    "Government Structure — Parliament, Judiciary and Constitutional Bodies": [
      "Constitutional Bodies and Offices",
      "Government Departments and Schemes",
      "Judiciary — Supreme Court and High Courts",
      "Parliament — Composition, Procedures and Powers",
    ],
    "Indian Constitution — Making, Foundation and Amendments": [
      "Constitutional Amendments",
      "Features, Parts and Schedules of Constitution",
      "Federal Structure — States, UTs and Finance",
      "Making of Constitution and Constitutional History",
    ],
    "World Polity, Democracy and International Relations": [
      "Democracy and Political Theory",
      "India's Foreign Policy — Panchsheel",
      "United Nations and Global Institutions",
    ],
  },
  "Economics": {
    "Indian Economy": [
      "Five Year Plans and Indian Planning",
      "Government Schemes — Agriculture and Livestock",
      "International Trade and Finance",
    ],
  },
  "Others": {
    "Awards, Honours, Books and Culture": [
      "Books, Literature and Authors",
      "Civilian Awards, Honours and Educational Institutions",
      "Indian Art, Architecture and Cultural Practices",
      "UNESCO Recognitions and Cultural Heritage",
    ],
    "Defence and Military Exercises": [
      "Defence Awards, Books and Institutions",
      "Defence Procurement and Cooperation",
      "Indian Navy — Ships, Vessels and Naval Policy",
      "Military Exercises — Bilateral and Multilateral",
    ],
    "Environment, Ecology and Energy": [
      "Climate Change and Summits",
      "Environmental Campaigns, Disasters and Energy",
      "Ramsar Sites, Wetlands and Protected Areas",
      "Wildlife Conservation and Species",
    ],
    "Government Schemes, Policy and Governance": [
      "Governance, Policy and Union Territory Reform",
      "Government Events, Reports and Announcements",
      "Health, Education and Welfare Schemes",
      "Infrastructure, Transport and Cultural Schemes",
    ],
    "Indian Economy": [
      "Five Year Plans and Indian Planning",
      "Government Schemes — Agriculture and Livestock",
      "International Trade and Finance",
    ],
    "International Affairs and Relations": [
      "India's Foreign Policy and Bilateral Relations",
      "International Organizations and Multilateral Bodies",
      "International Summits, Initiatives and Forums",
      "World Leaders, Elections and Global Events",
    ],
    "National Events, Persons and India General Knowledge": [
      "Indian Economy, Geography and Resources",
      "National Days, Festivals and Observances",
      "National Institutions, Milestones and History",
    ],
    "Science and Technology": [
      "DRDO, Defence and Marine Technology",
      "Health Technology, Science Awards and Anniversaries",
      "Information Technology and Railway Safety",
      "Nuclear and Renewable Energy",
      "Space Technology and Astronomy",
    ],
    "Sports": [
      "Cricket — Records, Tournaments and Players",
      "Other Sports and Personalities",
      "Tennis",
    ],
  },
}

/** Chapter names for a subject, in taxonomy order. Empty array when unknown. */
export function getTaxonomyChapters(subject) {
  return Object.keys(NDA_GAT_TAXONOMY[subject] || {})
}

/** Subtopics under one (subject, chapter). Empty array when unknown. */
export function getTaxonomySubtopics(subject, chapter) {
  return NDA_GAT_TAXONOMY[subject]?.[chapter] || []
}

/**
 * Every chapter a subtopic appears under, matched case-insensitively.
 *
 * Usually one. Three names in this taxonomy legitimately sit under two chapters
 * (see AMBIGUOUS_SUBTOPICS), so the plural is the honest return type.
 */
export function getChaptersForSubtopic(subject, subtopic) {
  const chapters = NDA_GAT_TAXONOMY[subject]
  if (!chapters || !subtopic) return []
  const want = String(subtopic).trim().toLowerCase()
  return Object.entries(chapters)
    .filter(([, subs]) => subs.some(s => s.toLowerCase() === want))
    .map(([chapter]) => chapter)
}

/**
 * The chapter a subtopic belongs to — ONLY when the subtopic names exactly one.
 *
 * Returns null both when the subtopic is unknown AND when it is ambiguous. The
 * ambiguous case is not theoretical: keying the 2026-08-08 repair on "a subtopic
 * determines its parent" moved W09 Q49 ("The committee _____ in their opinions",
 * a fill-in-the-blank) from Grammar to Spotting Errors, because
 * Subject-Verb Agreement sits under both. 1 wrong in 193.
 *
 * Callers must treat null as "leave the existing chapter alone", never as
 * "no chapter" — guessing here is what caused the defect ([[feedback_silent_fallback_hides_edge_errors]]).
 */
export function findChapterForSubtopic(subject, subtopic) {
  const hits = getChaptersForSubtopic(subject, subtopic)
  return hits.length === 1 ? hits[0] : null
}

/**
 * Subtopics that appear under more than one chapter of the same subject.
 *
 * Enumerated rather than deduplicated away: each really is taught in both
 * places, so collapsing them would misfile one of the two. A test pins this
 * list, so a taxonomy regeneration that adds a fourth fails loudly instead of
 * silently widening what findChapterForSubtopic refuses to answer.
 */
export const AMBIGUOUS_SUBTOPICS = Object.freeze({
  English: ['Correct Sentence Identification', 'Subject-Verb Agreement'],
  Chemistry: ['Physical vs Chemical Changes'],
})

/** Subjects that have a taxonomy — the gate every consumer should branch on. */
export function hasTaxonomy(subject) {
  return Boolean(NDA_GAT_TAXONOMY[subject])
}
