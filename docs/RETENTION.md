# Ana data retention

Ana keeps meeting-derived data for 60 days.

- Meeting transcripts, translations and MOM records: deleted after 60 days from the meeting end time (falling back to start/creation time).
- Meeting actions/to-dos: deleted with the source meeting, and orphaned actions are removed after 60 days.
- Temporary meeting audio: deleted immediately after the final transcription pass; it is not retained for 60 days.
- Glossary and account preferences: not covered by the 60-day meeting retention policy because they are user preferences rather than meeting records.
- Gmail OAuth connection data: remains until the user disconnects/revokes the integration; it is not meeting content.

A Supabase scheduled cleanup runs daily, and the client also prunes expired meeting history so deleted records are not re-uploaded from browser storage.
