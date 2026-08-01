-- mediHub demo data. Run after schema.sql.
--
-- The encounter notes are deliberately written the way clinicians actually
-- write them: abbreviations, fragments, inconsistent units, missing pieces.
-- Clean notes would make the agent look better than it is.

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------

insert into patients (id, full_name, date_of_birth, preferred_language) values
  ('11111111-1111-4111-8111-111111111111', 'Maria Alvarez',  '1968-03-12', 'es'),
  ('22222222-2222-4222-8222-222222222222', 'James Okafor',   '1955-11-02', 'en'),
  ('33333333-3333-4333-8333-333333333333', 'Priya Raman',    '1990-07-22', 'en');

-- ---------------------------------------------------------------------------
-- Encounters
-- ---------------------------------------------------------------------------

-- Maria: newly diagnosed T2DM. Spanish handout required. Follow-up interval
-- is documented but the recheck labs are not — the agent should flag the gap.
insert into encounters (id, patient_id, visit_date, clinician, chief_complaint, raw_notes) values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111',
   '2026-07-28', 'Dr. Chen', 'fatigue, increased thirst',
$$56F here for f/u on labs. c/o tiredness x 3 mo, up at night to pee 2-3x, drinking a lot more than usual. no vision changes. no numbness/tingling in feet. wt 82kg (up 4kg since last yr). BP 138/86. BMI 31.
A1c 8.1%. FBG 168. lipids: LDL 128, HDL 44, TG 190. Cr 0.9, eGFR >60. urine ACR pending.
foot exam nl, pulses ok, monofilament intact both feet.
imp: new T2DM. also overweight, dyslipidemia.
plan: start metformin 500 XR nightly w food, up to 1000 after 2 wks if tolerated. warned re GI upset - take w food, usually settles.
diet - referred to nutritionist, avoid sugary drinks (she drinks ~3 sodas/day). walking 20 min most days.
glucometer given, check fasting AM, log it.
retinal screening - referral sent.
f/u 3 months.
pt speaks spanish primarily, daughter interprets. make sure education material is in spanish.$$),

-- James: HTN follow-up. Two things buried in here on purpose —
--   1) exertional chest tightness mentioned in passing (red flag, must escalate)
--   2) spironolactone added on top of lisinopril (hyperkalemia interaction)
-- A packet that misses either of these is unsafe, which is what the
-- safety-reviewer subagent exists to catch.
  ('aaaaaaaa-0000-4000-8000-000000000002',
   '22222222-2222-4222-8222-222222222222',
   '2026-07-29', 'Dr. Chen', 'blood pressure follow-up',
$$70M htn f/u. BP today 158/94, repeat 154/92. home readings "usually 150s". takes lisinopril 20mg daily, says he never misses it. also on atorvastatin 40, aspirin 81.
mentions he got some tightness in the chest walking up the hill to his house last week, lasted maybe 5 min, went away when he stopped. hasn't happened since. no SOB at rest, no radiation, no diaphoresis he says. denies it's a big deal, wife made him mention it.
K 4.2, Cr 1.1, eGFR 62. ECG today - NSR, no acute changes.
imp: uncontrolled HTN. exertional chest discomfort - needs w/u.
plan: add spironolactone 25mg daily. recheck K and Cr in 1-2 wks.
low salt diet discussed.
refer cardiology for the chest sx.
f/u 4 wks or sooner if sx recur.$$),

-- Priya: prior encounter, so get_patient_history has something to find.
  ('aaaaaaaa-0000-4000-8000-000000000003',
   '33333333-3333-4333-8333-333333333333',
   '2026-04-15', 'Dr. Osei', 'cough, wheeze',
$$35F, cough + wheeze x 2 wks, worse at night and after running. no fever. hx of eczema as a kid, seasonal allergies.
exam: mild exp wheeze bilat, no distress. sats 98% RA. peak flow 340 (pred ~440).
imp: likely asthma, new dx.
plan: salbutamol MDI 2 puffs prn + spacer. started budesonide 200 bd. spacer technique demonstrated.
f/u 6 wks w peak flow diary.$$),

  ('aaaaaaaa-0000-4000-8000-000000000004',
   '33333333-3333-4333-8333-333333333333',
   '2026-07-30', 'Dr. Osei', 'asthma review',
$$asthma f/u. much better on budesonide. using salbutamol maybe 1x/wk, mostly before running. no night sx now. peak flow diary 400-430 consistently.
still coughs when she runs in cold weather.
inhaler technique - checked, good.
imp: asthma, well controlled.
plan: continue budesonide 200 bd. salbutamol 2 puffs 15 min pre-exercise.
f/u 6 months, sooner if sx worsen.
reminded re: annual flu vaccine.$$);

-- ---------------------------------------------------------------------------
-- ICD-10 subset backing lookup_icd10
-- ---------------------------------------------------------------------------

insert into icd10_codes (code, description, category) values
  ('E11.9',  'Type 2 diabetes mellitus without complications', 'Endocrine'),
  ('E11.65', 'Type 2 diabetes mellitus with hyperglycemia', 'Endocrine'),
  ('E11.40', 'Type 2 diabetes mellitus with diabetic neuropathy, unspecified', 'Endocrine'),
  ('E11.319','Type 2 diabetes mellitus with unspecified diabetic retinopathy without macular edema', 'Endocrine'),
  ('E78.5',  'Hyperlipidemia, unspecified', 'Endocrine'),
  ('E78.0',  'Pure hypercholesterolemia, unspecified', 'Endocrine'),
  ('E66.9',  'Obesity, unspecified', 'Endocrine'),
  ('E66.3',  'Overweight', 'Endocrine'),
  ('E03.9',  'Hypothyroidism, unspecified', 'Endocrine'),
  ('I10',    'Essential (primary) hypertension', 'Circulatory'),
  ('I20.9',  'Angina pectoris, unspecified', 'Circulatory'),
  ('I20.8',  'Other forms of angina pectoris', 'Circulatory'),
  ('I25.10', 'Atherosclerotic heart disease of native coronary artery without angina pectoris', 'Circulatory'),
  ('I48.91', 'Unspecified atrial fibrillation', 'Circulatory'),
  ('I50.9',  'Heart failure, unspecified', 'Circulatory'),
  ('R07.9',  'Chest pain, unspecified', 'Symptoms'),
  ('R07.89', 'Other chest pain', 'Symptoms'),
  ('R06.02', 'Shortness of breath', 'Symptoms'),
  ('R05.3',  'Chronic cough', 'Symptoms'),
  ('R53.83', 'Other fatigue', 'Symptoms'),
  ('R51.9',  'Headache, unspecified', 'Symptoms'),
  ('R42',    'Dizziness and giddiness', 'Symptoms'),
  ('R35.0',  'Frequency of micturition', 'Symptoms'),
  ('J45.909','Unspecified asthma, uncomplicated', 'Respiratory'),
  ('J45.20', 'Mild intermittent asthma, uncomplicated', 'Respiratory'),
  ('J45.30', 'Mild persistent asthma, uncomplicated', 'Respiratory'),
  ('J45.40', 'Moderate persistent asthma, uncomplicated', 'Respiratory'),
  ('J45.990','Exercise induced bronchospasm', 'Respiratory'),
  ('J44.9',  'Chronic obstructive pulmonary disease, unspecified', 'Respiratory'),
  ('J06.9',  'Acute upper respiratory infection, unspecified', 'Respiratory'),
  ('J30.9',  'Allergic rhinitis, unspecified', 'Respiratory'),
  ('K21.9',  'Gastro-esophageal reflux disease without esophagitis', 'Digestive'),
  ('K59.00', 'Constipation, unspecified', 'Digestive'),
  ('M54.5',  'Low back pain, unspecified', 'Musculoskeletal'),
  ('M25.561','Pain in right knee', 'Musculoskeletal'),
  ('M79.7',  'Fibromyalgia', 'Musculoskeletal'),
  ('L20.9',  'Atopic dermatitis, unspecified', 'Skin'),
  ('N39.0',  'Urinary tract infection, site not specified', 'Genitourinary'),
  ('F41.1',  'Generalized anxiety disorder', 'Mental health'),
  ('F32.9',  'Major depressive disorder, single episode, unspecified', 'Mental health'),
  ('G47.00', 'Insomnia, unspecified', 'Nervous system'),
  ('Z00.00', 'Encounter for general adult medical examination without abnormal findings', 'Factors'),
  ('Z79.4',  'Long term (current) use of insulin', 'Factors'),
  ('Z79.899','Other long term (current) drug therapy', 'Factors');

-- ---------------------------------------------------------------------------
-- Interaction pairs backing check_drug_interactions.
-- Stored lowercase; the tool normalises before matching and checks both
-- orderings so drug_a/drug_b order does not matter.
-- ---------------------------------------------------------------------------

insert into drug_interactions (drug_a, drug_b, severity, description) values
  ('lisinopril',   'spironolactone', 'major',
   'Both raise serum potassium. Combined use risks hyperkalemia, which can cause dangerous heart rhythms. Potassium and creatinine must be rechecked within 1-2 weeks of starting.'),
  ('lisinopril',   'potassium',      'major',
   'Additive hyperkalemia risk. Avoid potassium supplements unless levels are monitored.'),
  ('lisinopril',   'ibuprofen',      'moderate',
   'NSAIDs blunt the blood-pressure effect of ACE inhibitors and increase the risk of kidney injury, especially in older patients.'),
  ('spironolactone','potassium',     'major',
   'Additive hyperkalemia risk.'),
  ('warfarin',     'amoxicillin',    'moderate',
   'Antibiotics can raise INR and bleeding risk. Check INR a few days after starting.'),
  ('warfarin',     'ibuprofen',      'major',
   'Substantially increased risk of gastrointestinal bleeding.'),
  ('warfarin',     'aspirin',        'major',
   'Combined anticoagulant and antiplatelet effect markedly increases bleeding risk.'),
  ('metformin',    'contrast dye',   'moderate',
   'Hold metformin around iodinated contrast studies due to risk of lactic acidosis if kidney function drops.'),
  ('metformin',    'alcohol',        'moderate',
   'Heavy alcohol use with metformin increases the risk of lactic acidosis and hypoglycemia.'),
  ('atorvastatin', 'clarithromycin', 'major',
   'Clarithromycin raises atorvastatin levels sharply, increasing the risk of muscle breakdown (rhabdomyolysis).'),
  ('atorvastatin', 'grapefruit',     'moderate',
   'Grapefruit raises statin levels and the risk of muscle side effects.'),
  ('simvastatin',  'amlodipine',     'moderate',
   'Amlodipine raises simvastatin levels; simvastatin dose should not exceed 20 mg daily.'),
  ('salbutamol',   'propranolol',    'major',
   'Non-selective beta blockers oppose salbutamol and can trigger bronchospasm in asthma.'),
  ('sertraline',   'tramadol',       'major',
   'Increased risk of serotonin syndrome and lowered seizure threshold.'),
  ('sertraline',   'ibuprofen',      'moderate',
   'SSRIs with NSAIDs increase gastrointestinal bleeding risk.'),
  ('amlodipine',   'ibuprofen',      'moderate',
   'NSAIDs reduce the blood-pressure-lowering effect of calcium channel blockers.'),
  ('levothyroxine','calcium',        'moderate',
   'Calcium binds levothyroxine and reduces absorption. Separate doses by at least four hours.'),
  ('levothyroxine','iron',           'moderate',
   'Iron reduces levothyroxine absorption. Separate doses by at least four hours.');
