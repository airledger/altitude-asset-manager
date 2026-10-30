-- Swaps customer contact details in beta for safe dummies, so the test app can never email or text a real
-- customer. Business details (the company's own email, phone, address) and user logins are kept.
-- 07700 900xxx is Ofcom's range reserved for drama, and .invalid can never receive email.

update public.docs set data = data
  || jsonb_build_object('email', case when coalesce(data->>'email', '') = '' then '' else 'client-' || id || '@example.invalid' end)
  || jsonb_build_object('phone', case when coalesce(data->>'phone', '') = '' then '' else '07700 900' || lpad((abs(hashtext(id)) % 1000)::text, 3, '0') end)
where col = 'clients';

update public.docs set data = jsonb_set(data, '{signoff,clientEmail}', to_jsonb('client-' || id || '@example.invalid'))
where col = 'jobs' and coalesce(data #>> '{signoff,clientEmail}', '') <> '';

-- Beta has no email function, but make sure nothing tries to send automatically.
update public.docs set data = data || '{"autoEmailReports": false}'::jsonb
where col = 'config' and id = 'settings';
