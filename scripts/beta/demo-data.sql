-- Made-up records for testing on beta: clients, installs, units, materials and jobs, added to the first business.
-- Every id starts "demo-" so they're easy to spot and remove. Dates are relative to today, so the dashboard
-- always shows something overdue, due soon, booked and done. Safe to re-run (replaces the demo rows).
-- Contact details use reserved ranges: @example.invalid email and Ofcom's 07700 900xxx drama numbers.
\set ON_ERROR_STOP on
begin;

create temp table demo_org as select id from public.orgs order by created_at limit 1;
delete from public.docs where org_id = (select id from demo_org) and id like 'demo-%';
delete from public.docs where org_id = (select id from demo_org) and col = 'units' and id like 'AC-DMZ%';

create function pg_temp.d(days int) returns text language sql as $$ select (current_date + days)::text $$;

insert into public.docs (org_id, col, id, data)
select (select id from demo_org), col, id, data from (values
  -- Clients: two on a service plan, three out of contract
  ('clients', 'demo-c1', jsonb_build_object('name','Harbour View Dental','contactName','Priya Shah','phone','07700 900101','email','priya@example.invalid','preferredContact','Email','billingAddress','12 Quay Street, Bristol','postcode','BS1 4DJ','servicePlan','Annual service plan','planBilling','separate','remindersOptIn',true,'createdAt',pg_temp.d(-400))),
  ('clients', 'demo-c2', jsonb_build_object('name','The Old Bakery Café','contactName','Tom Reid','phone','07700 900102','email','tom@example.invalid','preferredContact','Text message','billingAddress','3 Mill Lane, Bath','postcode','BA1 2QT','servicePlan','None','remindersOptIn',true,'createdAt',pg_temp.d(-380))),
  ('clients', 'demo-c3', jsonb_build_object('name','Mr & Mrs Patel','contactName','Anil Patel','phone','07700 900103','email','anil@example.invalid','preferredContact','Phone','billingAddress','27 Elm Grove, Keynsham','postcode','BS31 1AB','servicePlan','None','remindersOptIn',true,'createdAt',pg_temp.d(-330))),
  ('clients', 'demo-c4', jsonb_build_object('name','Northgate Offices Ltd','contactName','Sarah Collins','phone','07700 900104','email','facilities@example.invalid','preferredContact','Email','billingAddress','Unit 5, Northgate Park, Bristol','postcode','BS2 8XY','servicePlan','Annual service plan','planBilling','visit','remindersOptIn',true,'createdAt',pg_temp.d(-700))),
  ('clients', 'demo-c5', jsonb_build_object('name','Greenway Vets','contactName','Jo Marsh','phone','07700 900105','email','jo@example.invalid','preferredContact','WhatsApp','billingAddress','88 High Street, Portishead','postcode','BS20 6EN','servicePlan','None','remindersOptIn',false,'createdAt',pg_temp.d(-200))),

  -- Systems (installs)
  ('systems', 'demo-s1', jsonb_build_object('clientId','demo-c1','name','Surgery – 2 head multi-split','siteAddress','12 Quay Street, Bristol','sitePostcode','BS1 4DJ','installDate',pg_temp.d(-380),'serviceIntervalMonths',12,'refrigerant','R32','factoryChargeKg',1.6,'addedChargeKg',0.3,'accessNotes','Outdoor unit on flat roof, ladder needed','contactLog','[]'::jsonb)),
  ('systems', 'demo-s2', jsonb_build_object('clientId','demo-c2','name','Café – ceiling cassette','siteAddress','3 Mill Lane, Bath','sitePostcode','BA1 2QT','installDate',pg_temp.d(-345),'serviceIntervalMonths',12,'refrigerant','R32','factoryChargeKg',1.2,'contactLog',jsonb_build_array(jsonb_build_object('date',pg_temp.d(-20),'method','Text message','note','Sent reminder')))),
  ('systems', 'demo-s3', jsonb_build_object('clientId','demo-c3','name','Bedroom wall unit','siteAddress','27 Elm Grove, Keynsham','sitePostcode','BS31 1AB','installDate',pg_temp.d(-300),'serviceIntervalMonths',12,'refrigerant','R32','factoryChargeKg',0.9,'contactLog','[]'::jsonb)),
  ('systems', 'demo-s4', jsonb_build_object('clientId','demo-c4','name','Open-plan office – VRF','siteAddress','Unit 5, Northgate Park, Bristol','sitePostcode','BS2 8XY','installDate',pg_temp.d(-720),'serviceIntervalMonths',6,'refrigerant','R410A','factoryChargeKg',9.5,'addedChargeKg',2.0,'leakDetection',false,'accessNotes','Sign in at reception. Plant room key in key safe 4471.','contactLog','[]'::jsonb)),
  ('systems', 'demo-s5', jsonb_build_object('clientId','demo-c5','name','Kennels – wall mounted x2','siteAddress','88 High Street, Portishead','sitePostcode','BS20 6EN','installDate',pg_temp.d(-150),'serviceIntervalMonths',12,'refrigerant','R32','factoryChargeKg',1.4,'contactLog','[]'::jsonb)),

  -- Materials (no prices here: prices are owner-only)
  ('materials', 'demo-m1', jsonb_build_object('name','Coil cleaner (can)','supplier','Climate Supplies','sku','CC-500','appliesTo','indoor','qtyPer',0.25,'when','service','active',true)),
  ('materials', 'demo-m2', jsonb_build_object('name','Antibacterial spray','supplier','Climate Supplies','sku','AB-400','appliesTo','indoor','qtyPer',0.5,'when','service','active',true)),
  ('materials', 'demo-m3', jsonb_build_object('name','Replacement filter','supplier','Parts Direct','sku','FLT-01','appliesTo','filter','qtyPer',1,'when','service','active',true)),
  ('materials', 'demo-m4', jsonb_build_object('name','Condensate pump tablets','supplier','Parts Direct','sku','PT-10','appliesTo','pump','qtyPer',1,'when','service','active',true)),
  ('materials', 'demo-m5', jsonb_build_object('name','Capacitor 35µF','supplier','Parts Direct','sku','CAP-35','appliesTo','visit','qtyPer',1,'when','pick','active',true)),

  -- Jobs: one completed last year, one booked next week, one booked but not closed, one cancelled
  ('jobs', 'demo-j1', jsonb_build_object('systemId','demo-s4','type','Annual service','status','completed','date',pg_temp.d(-200),'time','09:00','durationHrs',3,'engineer','Demo Engineer','leakCheck',jsonb_build_object('performed',true,'method','Direct – electronic detector','result','pass','addedKg',0,'recoveredKg',0),'materialsUsed','[]'::jsonb,'completionNotes','All units serviced. Filters cleaned.','completedAt',pg_temp.d(-200),'billing','plan')),
  ('jobs', 'demo-j2', jsonb_build_object('systemId','demo-s1','type','Annual service','status','booked','date',pg_temp.d(7),'time','10:00','durationHrs',1.5,'engineer','Demo Engineer','notes','Park at the rear.')),
  ('jobs', 'demo-j3', jsonb_build_object('systemId','demo-s3','type','Repair / breakdown','status','booked','date',pg_temp.d(-2),'time','14:00','durationHrs',1,'engineer','Demo Engineer','notes','Unit not cooling, error E5.')),
  ('jobs', 'demo-j4', jsonb_build_object('systemId','demo-s5','type','Annual service','status','cancelled','date',pg_temp.d(-30),'time','09:30','durationHrs',1.5,'engineer','Demo Engineer'))
) as v(col, id, data);

-- Units: sticker codes AC-DMZxx (valid AC-XXXXX codes, so typing one into Scan works).
insert into public.docs (org_id, col, id, data)
select (select id from demo_org), 'units', id, data from (values
  ('AC-DMZ22', jsonb_build_object('systemId','demo-s1','role','outdoor','manufacturer','Daikin','model','2MXM50A','serial','DK1001','location','Flat roof')),
  ('AC-DMZ23', jsonb_build_object('systemId','demo-s1','role','indoor','indoorType','Wall mounted','manufacturer','Daikin','model','FTXM25R','location','Surgery 1','filterType','Washable','controller','Wireless remote')),
  ('AC-DMZ24', jsonb_build_object('systemId','demo-s1','role','indoor','indoorType','Wall mounted','manufacturer','Daikin','model','FTXM25R','location','Surgery 2','filterType','Washable','controller','Wireless remote')),
  ('AC-DMZ25', jsonb_build_object('systemId','demo-s2','role','outdoor','manufacturer','Mitsubishi Electric','model','PUZ-ZM50','location','Rear yard')),
  ('AC-DMZ26', jsonb_build_object('systemId','demo-s2','role','indoor','indoorType','Cassette','manufacturer','Mitsubishi Electric','model','PLA-ZM50','location','Seating area','filterType','Replaceable','controller','Wired controller','condensatePump',true)),
  ('AC-DMZ27', jsonb_build_object('systemId','demo-s3','role','outdoor','manufacturer','Fujitsu','model','AOYG09KMCC','location','Side passage')),
  ('AC-DMZ28', jsonb_build_object('systemId','demo-s3','role','indoor','indoorType','Wall mounted','manufacturer','Fujitsu','model','ASYG09KMCC','location','Main bedroom','filterType','Washable','controller','Wireless remote')),
  ('AC-DMZ29', jsonb_build_object('systemId','demo-s4','role','outdoor','manufacturer','Toshiba','model','MMY-MAP1006','location','Plant room')),
  ('AC-DMZ32', jsonb_build_object('systemId','demo-s4','role','indoor','indoorType','Ducted','manufacturer','Toshiba','model','MMD-AP0186','location','Open-plan east','filterType','Replaceable','controller','Wired controller')),
  ('AC-DMZ33', jsonb_build_object('systemId','demo-s4','role','indoor','indoorType','Ducted','manufacturer','Toshiba','model','MMD-AP0186','location','Open-plan west','filterType','Replaceable','controller','Wired controller')),
  ('AC-DMZ34', jsonb_build_object('systemId','demo-s5','role','outdoor','manufacturer','Daikin','model','2MXM40A','location','Car park wall')),
  ('AC-DMZ35', jsonb_build_object('systemId','demo-s5','role','indoor','indoorType','Wall mounted','manufacturer','Daikin','model','FTXM20R','location','Kennel block A','filterType','Washable','controller','Wireless remote')),
  ('AC-DMZ36', jsonb_build_object('systemId','demo-s5','role','indoor','indoorType','Wall mounted','manufacturer','Daikin','model','FTXM20R','location','Kennel block B','filterType','Washable','controller','Wireless remote'))
) as v(id, data);

commit;
select col, count(*) from public.docs where id like 'demo-%' or id like 'AC-DMZ%' group by col order by col;
