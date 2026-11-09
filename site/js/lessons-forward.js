// lessons-forward.js — sends the old Assignments address to the one assignment page, keeping the whole link.
//
// faculty/lessons.html is a frozen address: AI tutor builds hand directors a link to it (?new=1&id=&course=&title=&desc=&url=&pub=),
// and older bookmarks and emails point at it (?a=<assignment id>). The page itself is gone; items.html does all of its jobs.
// The query string and the hash are carried over unchanged, so every one of those links opens the same thing it always did.
// `replace`, not `href`, so Back returns to where the reader came from instead of bouncing off this page again.
location.replace('items.html' + location.search + location.hash);
