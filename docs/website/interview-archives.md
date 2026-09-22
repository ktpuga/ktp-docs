# Interview archives

### Archived interview rounds

Under **Interviews > Set Up**, managers (executive board and pledge chair) can Archive a round, switch between Active and Archived lists, and open archived rounds to read their slots, booked applicants, interviewers and saved notes. Restore returns a round to the Active list as an unpublished draft; publishing remains explicit. Archive hides the round from rushee/interviewer signup lists and blocks new claims while retaining bookings, staffing, notes and candidate interview history. Existing note-access rules remain unchanged; the archive browser does not add permissions to private notes.

Apply migration `1792500000000_archive-interview-rounds.sql` before deploying API and website. Management API: `GET /interviews/schedules?archived=true` and `POST /interviews/schedules/:id/archive` with `{archived:true}` or `{archived:false}`. Archived scheduling edits require restoration. This retains records in the main database; it is separate from deleted-account archive storage. No actual rounds were archived during development.
