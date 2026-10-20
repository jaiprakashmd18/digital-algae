-- Local development seed (runs after migrations on `supabase db reset`).
-- The initial world itself is created by migration 20261020000005 so that
-- production gets it too; calling the function again is a no-op.
select public.seed_initial_world();

-- To make yourself an administrator locally, sign up in the app, then run
-- (replace the email):
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com';
