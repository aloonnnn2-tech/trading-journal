-- analytics_events/analytics_sessions.user_id were created without "on
-- delete cascade" (0013_analytics.sql), unlike every other user-owned
-- table in this app. That's fine until account deletion: auth.admin
-- deleteUser() would hit a foreign-key violation on any account with
-- analytics history (i.e. almost every real account), since Postgres
-- defaults to NO ACTION. Align these with the rest of the schema so
-- deleting a user cascades their analytics rows too.

alter table analytics_events drop constraint analytics_events_user_id_fkey;
alter table analytics_events add constraint analytics_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table analytics_sessions drop constraint analytics_sessions_user_id_fkey;
alter table analytics_sessions add constraint analytics_sessions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
