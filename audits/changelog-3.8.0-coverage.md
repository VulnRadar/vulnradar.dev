# 3.8.0 changelog condensation: coverage map

The in-progress 3.8.0 block held **553 entries**. It has been rewritten as
**55 grouped entries**. This file maps every one of the 553 original
entry labels to the new entry that now covers it.

- Original entries: **553**
- Distinct original labels: **488** (65 of the 553 were exact
  re-appended duplicates of an earlier entry; each is marked below and maps to
  the same new entry as its first occurrence)
- New entries: **55**
- Dropped: **0**. Nothing was discarded. The internal-only items (test runner,
  coverage gate, lint coverage for the self-host scripts, dropped database
  columns, dead permissions) are all folded into an entry that states their
  user-visible consequence rather than being deleted.

Category of each new entry is the most severe category of anything merged into
it, on the scale security > fixed > performance > changed > added.

## New entries and how many originals each absorbs

| New entry                                                               | Category    | Originals covered |
| ----------------------------------------------------------------------- | ----------- | ----------------- |
| A Fresh Self-Host Starts on a Blank Postgres                            | fixed       | 8                 |
| Your .env Actually Reaches the Container                                | fixed       | 6                 |
| You Can Log In to a Self-Host Without Configuring Email First           | fixed       | 2                 |
| CI Builds the Real Image, Boots It, and Waits for the Test Suite        | security    | 9                 |
| ARM64 Images, and a Latest Tag That Means the Latest Release            | fixed       | 3                 |
| Creating, Cloning and Upgrading a Database Stopped Skipping Tables      | fixed       | 11                |
| Backups and Encryption Keys Stopped Losing Data Quietly                 | security    | 5                 |
| An Unfinished Scan Is Never Reported as Clean                           | fixed       | 7                 |
| Ten Checks Gave Up After the First Match on the Page                    | security    | 10                |
| Findings That Reported the Wrong Thing                                  | fixed       | 8                 |
| A Hostile Page Can No Longer Stall the Scanner                          | security    | 7                 |
| More Internal Address Ranges Blocked, and Every Redirect Re-Checked     | security    | 5                 |
| Scans Send About Half the Requests They Used To                         | performance | 12                |
| Scans Stopped Failing and Hanging at the Edges                          | fixed       | 10                |
| Deep Scans Honour the Options You Picked                                | fixed       | 5                 |
| Five Ways to Run Scans That Charged Nothing                             | fixed       | 7                 |
| Billing Bugs That Downgraded the Wrong Account                          | fixed       | 6                 |
| One Page for Every Credit Balance                                       | fixed       | 4                 |
| The Pricing Page Says What You Get for the Money                        | changed     | 7                 |
| Sign-In, Sessions and Two-Factor Hardened                               | security    | 14                |
| Endpoints That Had No Rate Limit at All                                 | security    | 9                 |
| Staff Permissions That Were Not Actually Enforced                       | security    | 13                |
| A Private Scan No Longer Starts Public                                  | security    | 9                 |
| Shared Reports Unfurl, and the Preview Carries Your Own Branding        | fixed       | 5                 |
| Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    | security    | 6                 |
| The Scan Verdict Now Leads the Report                                   | changed     | 8                 |
| Sorting and Filtering a Report Is Instant and Survives the Back Button  | fixed       | 8                 |
| Scan History Tells You the Real Numbers                                 | fixed       | 12                |
| A Failed Load No Longer Reads as an Empty Account                       | fixed       | 16                |
| Actions That Failed in Silence Now Say So                               | fixed       | 17                |
| You Can Scan Your Own Site Without an Account                           | added       | 1                 |
| Team Scan Sharing Actually Works                                        | fixed       | 12                |
| Support Tickets Read Like a Conversation on Both Sides                  | fixed       | 6                 |
| The Admin Panel Opens on a Health Check                                 | changed     | 7                 |
| Sixteen Admin Panel Bugs                                                | fixed       | 16                |
| Admin Settings That Saved and Then Did Nothing                          | fixed       | 7                 |
| Light Mode Is Readable                                                  | fixed       | 14                |
| Keyboard Focus Is Visible and Skip Links Actually Move Focus            | fixed       | 12                |
| Every Dialog Behaves Like a Dialog                                      | fixed       | 10                |
| Nothing Scrolls Sideways on a Phone Any More                            | fixed       | 20                |
| Loading Screens Match the Page That Arrives                             | fixed       | 6                 |
| One Navbar on Every Public Page, and Links That Go Where They Say       | fixed       | 13                |
| Badges Now Show an A+ to F Grade                                        | fixed       | 3                 |
| Lists Stopped Loading Every Finding to Draw a Badge                     | performance | 10                |
| A Lot Less JavaScript on First Load                                     | performance | 9                 |
| The Changelog Page Stopped Downloading Every Release                    | fixed       | 3                 |
| Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          | fixed       | 9                 |
| PDF and CSV Reports Render What You Actually Wrote                      | fixed       | 6                 |
| The API Reference Documents the API That Exists                         | fixed       | 14                |
| Documentation Rewritten Where It Was Wrong                              | fixed       | 13                |
| Documentation You Can Skim                                              | changed     | 5                 |
| The Landing Page Says Who It Is For                                     | fixed       | 11                |
| The Check Reference Got Search, Filters, and Titles That Do Not Collide | fixed       | 11                |
| The Browser Extension Can Point at Your Own Instance                    | security    | 16                |
| The AI Assistant Answers From the Whole Document                        | fixed       | 5                 |

Total originals covered by the table above: 488 distinct labels, which expands to 553 original entries once the 65 duplicates are counted.

## Full mapping: every original entry to its new home

Row count in this table: **553** (check against 553).

| #   | Original category | Original label                                                                                    | Now covered by                                                          |
| --- | ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | fixed             | Your .env Actually Reaches the Container                                                          | Your .env Actually Reaches the Container                                |
| 2   | fixed             | You Can Log In to a Self-Host Without Configuring Email First                                     | You Can Log In to a Self-Host Without Configuring Email First           |
| 3   | fixed             | Self-Hosted Instances Show Their Own Support Address                                              | Your .env Actually Reaches the Container                                |
| 4   | fixed             | Published Limits Match the Enforced Ones                                                          | The API Reference Documents the API That Exists                         |
| 5   | fixed             | An Incomplete Test Run Can No Longer Pass                                                         | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 6   | changed           | The Scanning Screen No Longer Shows a Stopwatch                                                   | The Scan Verdict Now Leads the Report                                   |
| 7   | fixed             | Revoking a Share Link Tells You If It Failed                                                      | A Private Scan No Longer Starts Public                                  |
| 8   | fixed             | The Profile Page Says When It Could Not Load Something                                            | A Failed Load No Longer Reads as an Empty Account                       |
| 9   | fixed             | Repository Views No Longer Spin Forever on an Error                                               | A Failed Load No Longer Reads as an Empty Account                       |
| 10  | fixed             | Database Cleanup Asks Before Deleting                                                             | Sixteen Admin Panel Bugs                                                |
| 11  | fixed             | Suggested Passwords Are Always Rated Very Strong                                                  | Sign-In, Sessions and Two-Factor Hardened                               |
| 12  | added             | You Can Scan Your Own Site Without an Account                                                     | You Can Scan Your Own Site Without an Account                           |
| 13  | fixed             | Shared Reports Show a Preview Again                                                               | Shared Reports Unfurl, and the Preview Carries Your Own Branding        |
| 14  | fixed             | The Landing Page Stopped Denying the Extension Exists                                             | The Landing Page Says Who It Is For                                     |
| 15  | fixed             | The API Reference Documents the Field That Actually Exists                                        | The API Reference Documents the API That Exists                         |
| 16  | fixed             | Self-Hosting Docs No Longer Tell You to Demote Your Own Admin                                     | Documentation Rewritten Where It Was Wrong                              |
| 17  | fixed             | Contributor Docs Warn About the Lockfile Trap                                                     | Documentation Rewritten Where It Was Wrong                              |
| 18  | fixed             | Light Mode Is Readable                                                                            | Light Mode Is Readable                                                  |
| 19  | fixed             | Keyboard Focus Is Visible on Every Button                                                         | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 20  | fixed             | "Skip to content" Works on Every Page                                                             | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 21  | fixed             | The Dashboard Issue Count Goes Down When You Fix Things                                           | Scan History Tells You the Real Numbers                                 |
| 22  | changed           | Findings Are Ordered by What to Fix First                                                         | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 23  | fixed             | History Search Says When It Is Not Searching Everything                                           | Scan History Tells You the Real Numbers                                 |
| 24  | fixed             | Scheduled Scans Count Against Your Daily Limit                                                    | Five Ways to Run Scans That Charged Nothing                             |
| 25  | fixed             | Subdomain Discovery Is Metered and Respects the Blocklist                                         | Five Ways to Run Scans That Charged Nothing                             |
| 26  | fixed             | The AI Assistant's Large-Context Path Can No Longer Be Spoofed                                    | The AI Assistant Answers From the Whole Document                        |
| 27  | fixed             | Crawl Scans Through an API Key Now Count Against Your Limit                                       | Five Ways to Run Scans That Charged Nothing                             |
| 28  | fixed             | A Hostile Page Can No Longer Stall the Scanner                                                    | A Hostile Page Can No Longer Stall the Scanner                          |
| 29  | fixed             | A Crafted robots.txt Can No Longer Hang a Crawl                                                   | A Hostile Page Can No Longer Stall the Scanner                          |
| 30  | fixed             | The Rest of the Detector Patterns Got the Same Bound                                              | A Hostile Page Can No Longer Stall the Scanner                          |
| 31  | added             | CI Now Actually Boots a Self-Host                                                                 | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 32  | fixed             | A Fresh Self-Host Starts on an Empty Database                                                     | A Fresh Self-Host Starts on a Blank Postgres                            |
| 33  | fixed             | The Docker Image Tag in docker-compose.yml Exists                                                 | A Fresh Self-Host Starts on a Blank Postgres                            |
| 34  | fixed             | Database and Backup Commands Are Present in the Container                                         | A Fresh Self-Host Starts on a Blank Postgres                            |
| 35  | fixed             | An Unfinished Scan No Longer Reports as Clean                                                     | An Unfinished Scan Is Never Reported as Clean                           |
| 36  | fixed             | Clearing History Tells You the Real Number                                                        | Scan History Tells You the Real Numbers                                 |
| 37  | fixed             | docker compose build Works From a Checkout                                                        | A Fresh Self-Host Starts on a Blank Postgres                            |
| 38  | fixed             | Admin Row Actions Visible On Touch                                                                | Nothing Scrolls Sideways on a Phone Any More                            |
| 39  | fixed             | Blocked Data Panel No Longer Fakes An All-Clear                                                   | A Failed Load No Longer Reads as an Empty Account                       |
| 40  | fixed             | Save As Draft No Longer Loses A Composed Broadcast                                                | Actions That Failed in Silence Now Say So                               |
| 41  | fixed             | Renaming A Team Works On A Phone                                                                  | Sixteen Admin Panel Bugs                                                |
| 42  | fixed             | Teams Page-Size Selector Actually Changes The Page Size                                           | Sixteen Admin Panel Bugs                                                |
| 43  | fixed             | Engine Feedback Dialog Scrolls On Short Screens                                                   | Sixteen Admin Panel Bugs                                                |
| 44  | fixed             | Four More Admin Panels Are Usable On A Phone                                                      | Nothing Scrolls Sideways on a Phone Any More                            |
| 45  | added             | Access Rules Can Expire And Be Paused                                                             | Sixteen Admin Panel Bugs                                                |
| 46  | fixed             | Honest Wording For Build-Time Settings                                                            | Admin Settings That Saved and Then Did Nothing                          |
| 47  | fixed             | System Settings No Longer Shows False Defaults                                                    | A Failed Load No Longer Reads as an Empty Account                       |
| 48  | fixed             | Admin Panels Say When They Failed To Load                                                         | A Failed Load No Longer Reads as an Empty Account                       |
| 49  | fixed             | A Server Error No Longer Reads As "Access Denied"                                                 | A Failed Load No Longer Reads as an Empty Account                       |
| 50  | performance       | Admin Panel Loads Far Less JavaScript                                                             | A Lot Less JavaScript on First Load                                     |
| 51  | security          | Staff Invites Require Your Password                                                               | Staff Permissions That Were Not Actually Enforced                       |
| 52  | changed           | Confirmation Dialogs Where They Belong                                                            | Sixteen Admin Panel Bugs                                                |
| 53  | fixed             | Sorting The Users Table Sorts All Users                                                           | Sixteen Admin Panel Bugs                                                |
| 54  | added             | Jump Straight To An Account From Support And The Audit Log                                        | Sixteen Admin Panel Bugs                                                |
| 55  | fixed             | Admin Risk Scores Match The Scanner                                                               | Sixteen Admin Panel Bugs                                                |
| 56  | fixed             | Admin Table Headers Stay Put While Scrolling                                                      | Sixteen Admin Panel Bugs                                                |
| 57  | fixed             | Mobile Admin Fixes: Toasts, Filters, Banner And Contents Pill                                     | Nothing Scrolls Sideways on a Phone Any More                            |
| 58  | fixed             | Settings Tabs Open The Tab You Tapped                                                             | Sixteen Admin Panel Bugs                                                |
| 59  | fixed             | Admin Controls Match The Permissions They Need                                                    | Staff Permissions That Were Not Actually Enforced                       |
| 60  | fixed             | Admin Form Fields Are Properly Labelled                                                           | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 61  | fixed             | Admin Sidebar Stays Clickable Under Banners                                                       | Sixteen Admin Panel Bugs                                                |
| 62  | fixed             | Scan Results No Longer Scroll Sideways On A Phone                                                 | Nothing Scrolls Sideways on a Phone Any More                            |
| 63  | fixed             | Account Settings Tabs Are Readable On Mobile                                                      | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 64  | fixed             | History Tabs Stopped Wrapping Into Two Ragged Lines                                               | Nothing Scrolls Sideways on a Phone Any More                            |
| 65  | fixed             | Rescan From History Says What Happened                                                            | Actions That Failed in Silence Now Say So                               |
| 66  | fixed             | History Rows Have Actions On A Phone                                                              | Nothing Scrolls Sideways on a Phone Any More                            |
| 67  | fixed             | Scan Notes No Longer Vanish When Saving Fails                                                     | Actions That Failed in Silence Now Say So                               |
| 68  | fixed             | Deep Scans Respect The Check Families You Picked                                                  | Deep Scans Honour the Options You Picked                                |
| 69  | fixed             | Missing Email Preferences Added To Your Account                                                   | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 70  | fixed             | A Failed Load No Longer Says You Have No Scans                                                    | A Failed Load No Longer Reads as an Empty Account                       |
| 71  | fixed             | Opening A Scan That Cannot Be Loaded Explains Itself                                              | Actions That Failed in Silence Now Say So                               |
| 72  | fixed             | Profile Picture Upload Failures Are Visible                                                       | Actions That Failed in Silence Now Say So                               |
| 73  | fixed             | A Server Hiccup No Longer Logs You Out Of Your Profile                                            | Actions That Failed in Silence Now Say So                               |
| 74  | fixed             | Status Messages Follow You Down Long Settings Pages                                               | Actions That Failed in Silence Now Say So                               |
| 75  | fixed             | Billing Errors Read Like English                                                                  | Billing Bugs That Downgraded the Wrong Account                          |
| 76  | security          | Changing A Scan's Visibility Confirms Or Refuses                                                  | A Private Scan No Longer Starts Public                                  |
| 77  | fixed             | AI Verification Says Why It Did Not Run                                                           | The AI Assistant Answers From the Whole Document                        |
| 78  | fixed             | Post-Scan Dialog Works With A Keyboard                                                            | Every Dialog Behaves Like a Dialog                                      |
| 79  | changed           | Search Findings By Check ID                                                                       | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 80  | fixed             | Report Exports Show Progress And Confirm The Download                                             | Actions That Failed in Silence Now Say So                               |
| 81  | fixed             | Scan Tags Report Failures And Cannot Be Double-Clicked                                            | Actions That Failed in Silence Now Say So                               |
| 82  | fixed             | The Invisible Tag Button On History Rows Is Gone                                                  | Nothing Scrolls Sideways on a Phone Any More                            |
| 83  | fixed             | Dashboard Activity Handles A Failed Load                                                          | A Failed Load No Longer Reads as an Empty Account                       |
| 84  | fixed             | A Stalled Connection No Longer Freezes The Scanning Page                                          | Scans Stopped Failing and Hanging at the Edges                          |
| 85  | performance       | Leaving The Dashboard Stops The Status Polling                                                    | A Lot Less JavaScript on First Load                                     |
| 86  | fixed             | Bulk Scanning Says Queued, Not Scanned                                                            | Actions That Failed in Silence Now Say So                               |
| 87  | fixed             | Software Inventory Header Stops Clipping On Mobile                                                | Nothing Scrolls Sideways on a Phone Any More                            |
| 88  | fixed             | Switching Between Findings No Longer Crashes The View                                             | Scans Stopped Failing and Hanging at the Edges                          |
| 89  | changed           | Findings Come First In A Scan Report                                                              | The Scan Verdict Now Leads the Report                                   |
| 90  | changed           | The Fix Is Closer To The Top Of A Finding                                                         | The Scan Verdict Now Leads the Report                                   |
| 91  | fixed             | Fetch DNS Records Or Run A Port Sweep After The Fact                                              | Deep Scans Honour the Options You Picked                                |
| 92  | fixed             | Removing Your AI Provider Now Asks First                                                          | The AI Assistant Answers From the Whole Document                        |
| 93  | fixed             | Scheduled Backup Failures Now Raise An Alert                                                      | Backups and Encryption Keys Stopped Losing Data Quietly                 |
| 94  | security          | Suspending An Account Now Stops Its API Keys                                                      | Staff Permissions That Were Not Actually Enforced                       |
| 95  | security          | Rotating The Encryption Key No Longer Destroys 2FA Seeds                                          | Backups and Encryption Keys Stopped Losing Data Quietly                 |
| 96  | security          | Discord Sign-In Is Now Tied To Your Browser                                                       | Sign-In, Sessions and Two-Factor Hardened                               |
| 97  | security          | Asset Directory No Longer Exposes Full Scanned URLs                                               | A Private Scan No Longer Starts Public                                  |
| 98  | security          | Staff 2FA Enforcement Now Covers Support Tickets                                                  | Staff Permissions That Were Not Actually Enforced                       |
| 99  | security          | Shared Support Tickets End When The Team Membership Does                                          | Staff Permissions That Were Not Actually Enforced                       |
| 100 | performance       | Public Scans Directory Loads Much Faster                                                          | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 101 | fixed             | Dashboard Activity Tooltip Shows Real Issue Counts                                                | Scan History Tells You the Real Numbers                                 |
| 102 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans                           | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 103 | fixed             | Usage Metering Failures Are No Longer Silent                                                      | Scans Stopped Failing and Hanging at the Edges                          |
| 104 | security          | IPv6 Rate Limits Can No Longer Be Sidestepped                                                     | Endpoints That Had No Rate Limit at All                                 |
| 105 | security          | Turning Off API Keys Now Turns Off Existing Keys                                                  | Staff Permissions That Were Not Actually Enforced                       |
| 106 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration                                 | Billing Bugs That Downgraded the Wrong Account                          |
| 107 | fixed             | Discord Sign-In Honours The Configured 2FA Code Expiry                                            | Sign-In, Sessions and Two-Factor Hardened                               |
| 108 | fixed             | Share Settings Now Apply To An Existing Link                                                      | A Private Scan No Longer Starts Public                                  |
| 109 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request                               | The AI Assistant Answers From the Whole Document                        |
| 110 | fixed             | A Gifted Plan Can No Longer Downgrade A Paying Customer                                           | Billing Bugs That Downgraded the Wrong Account                          |
| 111 | security          | Account Deletion Now Clears Feedback Notes And Email Records                                      | A Private Scan No Longer Starts Public                                  |
| 112 | fixed             | Self-Hosted AI Requests Identify Your Own Deployment                                              | Your .env Actually Reaches the Container                                |
| 113 | fixed             | Public Host Reports Load Again                                                                    | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 114 | fixed             | Contact Form Messages Now Reach Us                                                                | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 115 | fixed             | Staff SSO Sign-In Works                                                                           | Sign-In, Sessions and Two-Factor Hardened                               |
| 116 | fixed             | Admin Settings Now Say What They Actually Do                                                      | Admin Settings That Saved and Then Did Nothing                          |
| 117 | fixed             | Backups And Avatars Survive A Container Update                                                    | A Fresh Self-Host Starts on a Blank Postgres                            |
| 118 | fixed             | A Missing Encryption Key Now Fails Loudly                                                         | A Fresh Self-Host Starts on a Blank Postgres                            |
| 119 | added             | ARM64 Docker Images                                                                               | ARM64 Images, and a Latest Tag That Means the Latest Release            |
| 120 | fixed             | Release Candidates No Longer Offered As Upgrades                                                  | ARM64 Images, and a Latest Tag That Means the Latest Release            |
| 121 | fixed             | Digest-Pinned Images Stop Disappearing                                                            | ARM64 Images, and a Latest Tag That Means the Latest Release            |
| 122 | security          | Automatic Base Image Updates                                                                      | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 123 | changed           | A Product Description That Says Something                                                         | The Landing Page Says Who It Is For                                     |
| 124 | fixed             | Fork-Friendly Community And Store Links                                                           | Shared Reports Unfurl, and the Preview Carries Your Own Branding        |
| 125 | changed           | Self-Hosting Documentation Gaps                                                                   | Your .env Actually Reaches the Container                                |
| 126 | fixed             | Configuration Docs Now Describe The Real System                                                   | Documentation Rewritten Where It Was Wrong                              |
| 127 | fixed             | A Real Way Back In When 2FA Email Stops Arriving                                                  | You Can Log In to a Self-Host Without Configuring Email First           |
| 128 | added             | Upgrade And Rollback Are Documented                                                               | Documentation Rewritten Where It Was Wrong                              |
| 129 | fixed             | API Key Responses Documented As They Actually Are                                                 | The API Reference Documents the API That Exists                         |
| 130 | fixed             | Scan History Endpoints Corrected                                                                  | The API Reference Documents the API That Exists                         |
| 131 | fixed             | Rate-Limit Headers: What Actually Arrives                                                         | The API Reference Documents the API That Exists                         |
| 132 | fixed             | Free Accounts Do Get A Webhook                                                                    | The API Reference Documents the API That Exists                         |
| 133 | security          | CI Integration Snippet No Longer Pins A Moving Branch                                             | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 134 | fixed             | Crawl Page Limits Match The Product                                                               | The API Reference Documents the API That Exists                         |
| 135 | fixed             | Correct HTTP Status Codes In The Error Table                                                      | The API Reference Documents the API That Exists                         |
| 136 | fixed             | The Permissions Model Documented Correctly                                                        | The API Reference Documents the API That Exists                         |
| 137 | fixed             | Docs Pages No Longer Publish Contradictory Search Metadata                                        | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 138 | fixed             | API Playground Inputs Are Labelled                                                                | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 139 | changed           | Contributor And Security Docs Say What Is True                                                    | Documentation Rewritten Where It Was Wrong                              |
| 140 | changed           | A Better First Screen On The README And Docs                                                      | Documentation Rewritten Where It Was Wrong                              |
| 141 | added             | Every Script The Project Ships Is Now Listed                                                      | Documentation Rewritten Where It Was Wrong                              |
| 142 | fixed             | Readable Arrows And Symbols In PDF Reports                                                        | PDF and CSV Reports Render What You Actually Wrote                      |
| 143 | changed           | PDF Reports Use The Current Brand Colour                                                          | PDF and CSV Reports Render What You Actually Wrote                      |
| 144 | changed           | Real Severity Bar On The PDF Cover                                                                | PDF and CSV Reports Render What You Actually Wrote                      |
| 145 | fixed             | Long Evidence No Longer Runs Off The Page In PDF Reports                                          | PDF and CSV Reports Render What You Actually Wrote                      |
| 146 | fixed             | One-Click Unsubscribe On Notification Email                                                       | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 147 | changed           | Useful Inbox Preview Text On Every Email                                                          | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 148 | fixed             | The No-Reply Address Setting Now Affects Outgoing Mail                                            | Your .env Actually Reaches the Container                                |
| 149 | fixed             | Expiry Times In Email Match The Real Setting                                                      | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 150 | added             | The Browser Extension Can Point At A Self-Hosted Instance                                         | The Browser Extension Can Point at Your Own Instance                    |
| 151 | fixed             | The Extension's Port Sweep Setting Works Again                                                    | The Browser Extension Can Point at Your Own Instance                    |
| 152 | security          | The Extension No Longer Exposes Its Pages To Any Website                                          | The Browser Extension Can Point at Your Own Instance                    |
| 153 | fixed             | The Extension Recovers From An Interrupted Scan                                                   | The Browser Extension Can Point at Your Own Instance                    |
| 154 | changed           | Clearer Empty And Incomplete States In The Extension                                              | The Browser Extension Can Point at Your Own Instance                    |
| 155 | changed           | The Extension Looks Like The Rest Of The Product                                                  | The Browser Extension Can Point at Your Own Instance                    |
| 156 | performance       | Scans No Longer Wait On Subdomain Discovery                                                       | Scans Send About Half the Requests They Used To                         |
| 157 | fixed             | Deep Scans Can Now Report An Incomplete Result                                                    | An Unfinished Scan Is Never Reported as Clean                           |
| 158 | fixed             | A Broken Check No Longer Counts As A Passed Check                                                 | An Unfinished Scan Is Never Reported as Clean                           |
| 159 | fixed             | A Slow-Trickling Target Can No Longer Stall A Scan                                                | A Hostile Page Can No Longer Stall the Scanner                          |
| 160 | security          | More Internal Address Ranges Blocked                                                              | More Internal Address Ranges Blocked, and Every Redirect Re-Checked     |
| 161 | performance       | Faster CVE Correlation At The End Of A Scan                                                       | Scans Send About Half the Requests They Used To                         |
| 162 | fixed             | Alerts Now Fire When A Finding Gets Worse                                                         | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 163 | fixed             | A Timed-Out Email Security Check Now Says So                                                      | An Unfinished Scan Is Never Reported as Clean                           |
| 164 | fixed             | A Timed-Out Scan Now Actually Stops                                                               | Scans Stopped Failing and Hanging at the Edges                          |
| 165 | fixed             | Scheduled-Scan Worker Health Alerts                                                               | Scans Stopped Failing and Hanging at the Edges                          |
| 166 | fixed             | API Docs And Playground Corrections                                                               | The API Reference Documents the API That Exists                         |
| 167 | fixed             | Search Results For Check Pages No Longer Cut Off Mid-Sentence                                     | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 168 | fixed             | Category Pages Show Their Check Count In Search Again                                             | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 169 | fixed             | Nine Missing Documentation Pages Added To The Sitemap                                             | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 170 | performance       | The AI Chat Widget No Longer Loads On Every Page Up Front                                         | A Lot Less JavaScript on First Load                                     |
| 171 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu                                 | Nothing Scrolls Sideways on a Phone Any More                            |
| 172 | fixed             | Skip To Main Content Now Actually Moves Focus                                                     | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 173 | fixed             | Readable Contrast On Delete Buttons And Secondary Text                                            | Light Mode Is Readable                                                  |
| 174 | changed           | One Dimming Style For Every Dialog                                                                | Every Dialog Behaves Like a Dialog                                      |
| 175 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button                                   | Every Dialog Behaves Like a Dialog                                      |
| 176 | changed           | Documentation Line Length And Header Alignment                                                    | Documentation You Can Skim                                              |
| 177 | fixed             | Pagination No Longer Pushes The Page Sideways On A Phone                                          | Nothing Scrolls Sideways on a Phone Any More                            |
| 178 | fixed             | The Notification Bell Says When It Could Not Load                                                 | A Failed Load No Longer Reads as an Empty Account                       |
| 179 | added             | Search And Severity Filters On The Check Index                                                    | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 180 | added             | You Can Now Propose A Check                                                                       | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 181 | changed           | The New Account Tour Sounds Like The Rest Of The Product                                          | The Landing Page Says Who It Is For                                     |
| 182 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports                     | The Landing Page Says Who It Is For                                     |
| 183 | changed           | The Hero Caption No Longer Undersells The Scan                                                    | The Landing Page Says Who It Is For                                     |
| 184 | fixed             | The Probely Comparison Page Is Up To Date                                                         | The Landing Page Says Who It Is For                                     |
| 185 | fixed             | The Accessibility Statement Only Claims What We Actually Do                                       | Documentation Rewritten Where It Was Wrong                              |
| 186 | fixed             | Public Scans No Longer Shows Signed-In Tabs To Visitors                                           | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 187 | fixed             | Honest Summary On The Configuration Docs Link                                                     | Documentation Rewritten Where It Was Wrong                              |
| 188 | fixed             | Team Scan Sharing Actually Saves The Team                                                         | Team Scan Sharing Actually Works                                        |
| 189 | fixed             | Feature Switches Now Reach The Whole Feature                                                      | Admin Settings That Saved and Then Did Nothing                          |
| 190 | performance       | Faster Start For Every Scan                                                                       | Scans Send About Half the Requests They Used To                         |
| 191 | fixed             | SQL Injection Detection No Longer Misses Repeated Queries                                         | Ten Checks Gave Up After the First Match on the Page                    |
| 192 | fixed             | AI-Code Checks Now Look At Every Match, Not Just The First                                        | Ten Checks Gave Up After the First Match on the Page                    |
| 193 | fixed             | Correct Iframe Origin Matching On IPv6 Targets                                                    | Findings That Reported the Wrong Thing                                  |
| 194 | fixed             | Debug Toolbar And Broken Redirect Checks No Longer Stop At The First Match                        | Ten Checks Gave Up After the First Match on the Page                    |
| 195 | fixed             | Fewer False Alarms On Embedded Forms                                                              | Findings That Reported the Wrong Thing                                  |
| 196 | security          | Secrets Hidden Behind An Example No Longer Missed                                                 | Ten Checks Gave Up After the First Match on the Page                    |
| 197 | fixed             | Clearer Stripe Key Finding                                                                        | Findings That Reported the Wrong Thing                                  |
| 198 | fixed             | postMessage Issue No Longer Counted Twice                                                         | Findings That Reported the Wrong Thing                                  |
| 199 | fixed             | Corrected Inline Iframe Finding Text                                                              | Findings That Reported the Wrong Thing                                  |
| 200 | fixed             | Session Cookie Checks No Longer Stop At The First Safe Cookie                                     | Ten Checks Gave Up After the First Match on the Page                    |
| 201 | fixed             | Hardcoded API Key Check Now Scans The Whole Page                                                  | Ten Checks Gave Up After the First Match on the Page                    |
| 202 | fixed             | GraphQL Field Suggestions Are Detected Again                                                      | Ten Checks Gave Up After the First Match on the Page                    |
| 203 | fixed             | A Harmless First Match No Longer Hides A Real One                                                 | Ten Checks Gave Up After the First Match on the Page                    |
| 204 | changed           | More Honest Confidence On Two API Checks                                                          | Findings That Reported the Wrong Thing                                  |
| 205 | changed           | Clearer Wording On GraphQL Introspection And Exposed Files                                        | Findings That Reported the Wrong Thing                                  |
| 206 | fixed             | Mixed Content No Longer Hidden By A Code Sample                                                   | Ten Checks Gave Up After the First Match on the Page                    |
| 207 | fixed             | Enumerable ID Check No Longer Stops At The First Match                                            | Ten Checks Gave Up After the First Match on the Page                    |
| 208 | performance       | Crawl Scans Stopped Repeating Themselves                                                          | Scans Send About Half the Requests They Used To                         |
| 209 | security          | Wider Internal IPv6 Address Blocking                                                              | More Internal Address Ranges Blocked, and Every Redirect Re-Checked     |
| 210 | security          | Address Checks Now Verify The Protocol Too                                                        | More Internal Address Ranges Blocked, and Every Redirect Re-Checked     |
| 211 | security          | Subdomain Discovery Sources Are Guarded                                                           | More Internal Address Ranges Blocked, and Every Redirect Re-Checked     |
| 212 | security          | Screenshots Refuse Redirected Pages                                                               | More Internal Address Ranges Blocked, and Every Redirect Re-Checked     |
| 213 | performance       | Faster Blocklist Checks On Bulk And Crawl Scans                                                   | Scans Send About Half the Requests They Used To                         |
| 214 | fixed             | The Scheduled Scans Switch Now Actually Stops Them                                                | Admin Settings That Saved and Then Did Nothing                          |
| 215 | fixed             | Removed A Daily Scan Limit Setting That Did Nothing                                               | Five Ways to Run Scans That Charged Nothing                             |
| 216 | security          | Dropped A Duplicate Session Revoke Action                                                         | Staff Permissions That Were Not Actually Enforced                       |
| 217 | performance       | Faster Team List In The Admin Panel                                                               | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 218 | changed           | Admin Panel Now Lines Up With Every Other Page                                                    | Sixteen Admin Panel Bugs                                                |
| 219 | fixed             | Billing Plan Table Scrolls Instead Of Squashing                                                   | Nothing Scrolls Sideways on a Phone Any More                            |
| 220 | fixed             | Badge Selection Is Now Announced To Screen Readers                                                | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 221 | changed           | Email Typography Matches The App Again                                                            | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 222 | fixed             | Corrected The Crawl Discovery Quota In The Docs                                                   | The API Reference Documents the API That Exists                         |
| 223 | added             | Docs For Importing Scans Into DefectDojo And Faraday                                              | PDF and CSV Reports Render What You Actually Wrote                      |
| 224 | performance       | Scans No Longer Freeze Each Other                                                                 | Scans Send About Half the Requests They Used To                         |
| 225 | performance       | Fewer Repeated DNS Lookups Per Scan                                                               | Scans Send About Half the Requests They Used To                         |
| 226 | changed           | Politer Exposed-File Probing                                                                      | Scans Send About Half the Requests They Used To                         |
| 227 | fixed             | Fixed A Scan Stall On Pages With Long Dotted Text                                                 | A Hostile Page Can No Longer Stall the Scanner                          |
| 228 | fixed             | Database Upgrades No Longer Skip Tables                                                           | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 229 | fixed             | Cloning A Database Now Copies Everything                                                          | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 230 | fixed             | Fresh Database Setup Was Missing A Sixth Of The Schema                                            | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 231 | fixed             | Safer Sequence Repair During Upgrades                                                             | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 232 | fixed             | GitHub Review Usage Tracking Fixed On Upgrade                                                     | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 233 | fixed             | Webhook Delivery Log Is Now Pruned                                                                | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 234 | fixed             | Email 2FA Works On Google, GitHub And Discord Accounts                                            | Sign-In, Sessions and Two-Factor Hardened                               |
| 235 | fixed             | Turning Teams Off Now Actually Turns Teams Off                                                    | Team Scan Sharing Actually Works                                        |
| 236 | fixed             | API Rate-Limit Message Shows Your Real Limit                                                      | Five Ways to Run Scans That Charged Nothing                             |
| 237 | fixed             | Bulk Remediation Changes Now Apply All Or Nothing                                                 | Actions That Failed in Silence Now Say So                               |
| 238 | security          | Failed Scans No Longer Show Server Internals                                                      | A Private Scan No Longer Starts Public                                  |
| 239 | performance       | Shares Page Loads Much Faster                                                                     | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 240 | performance       | Smaller Avatar Downloads From GitHub And Discord                                                  | A Lot Less JavaScript on First Load                                     |
| 241 | fixed             | Bulk And Authenticated Scans Respect Your Concurrent Scan Limit                                   | Five Ways to Run Scans That Charged Nothing                             |
| 242 | security          | Report Exports Are Rate Limited                                                                   | Endpoints That Had No Rate Limit at All                                 |
| 243 | security          | One Attacker Can No Longer Lock You Out Of Your Account                                           | Sign-In, Sessions and Two-Factor Hardened                               |
| 244 | performance       | Faster API Rejection Of Unknown Keys                                                              | Endpoints That Had No Rate Limit at All                                 |
| 245 | fixed             | Billing, Enterprise And Feedback Contact Messages Keep Their Category                             | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 246 | security          | Turning Two-Factor Off Now Clears Trusted Devices                                                 | Sign-In, Sessions and Two-Factor Hardened                               |
| 247 | security          | Changing Your Email Signs Out Your Other Sessions                                                 | Sign-In, Sessions and Two-Factor Hardened                               |
| 248 | fixed             | Staff Accounts Keep Their Plan After A Subscription Ends                                          | Billing Bugs That Downgraded the Wrong Account                          |
| 249 | fixed             | A Lapsed Subscription No Longer Removes A Gifted Premium Badge                                    | Billing Bugs That Downgraded the Wrong Account                          |
| 250 | fixed             | Scheduled-Scan Plan Limit Can No Longer Be Exceeded By Racing                                     | Five Ways to Run Scans That Charged Nothing                             |
| 251 | security          | Stripe Setup Endpoints Follow The Normal Admin Rules                                              | Staff Permissions That Were Not Actually Enforced                       |
| 252 | security          | Public Scan Reports Are Rate Limited                                                              | Endpoints That Had No Rate Limit at All                                 |
| 253 | security          | Scan Screenshots Can No Longer Be Enumerated                                                      | Endpoints That Had No Rate Limit at All                                 |
| 254 | performance       | Data Export No Longer Starves The Rest Of The App                                                 | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 255 | performance       | Faster Account Load And Lighter Weekly Digest                                                     | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 256 | performance       | Notification Page Filters Can No Longer Freeze A Tab                                              | A Lot Less JavaScript on First Load                                     |
| 257 | fixed             | Screen Readers No Longer Read Past A Dialog                                                       | Every Dialog Behaves Like a Dialog                                      |
| 258 | fixed             | Demo Scans Stop Their Own Background Work                                                         | Scans Stopped Failing and Hanging at the Edges                          |
| 259 | changed           | Test Coverage Is Actually Enforced Now                                                            | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 260 | changed           | Static Checks For The Self-Host Scripts                                                           | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 261 | changed           | Scan Speed Guardrails In The Test Suite                                                           | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 262 | performance       | Finished Scans Appear Sooner                                                                      | Scans Send About Half the Requests They Used To                         |
| 263 | fixed             | Try Again Now Actually Retries                                                                    | Actions That Failed in Silence Now Say So                               |
| 264 | fixed             | Back Button No Longer Wipes A Finished Scan                                                       | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 265 | fixed             | A Failed Load No Longer Looks Like An Empty Result                                                | A Failed Load No Longer Reads as an Empty Account                       |
| 266 | fixed             | Bigger Tap Targets Across The App                                                                 | Nothing Scrolls Sideways on a Phone Any More                            |
| 267 | fixed             | Screen Reader And Keyboard Improvements                                                           | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 268 | fixed             | Input Outlines You Can Actually See                                                               | Light Mode Is Readable                                                  |
| 269 | fixed             | CSV Exports Open Correctly In Excel                                                               | PDF and CSV Reports Render What You Actually Wrote                      |
| 270 | performance       | Lighter Pages                                                                                     | A Lot Less JavaScript on First Load                                     |
| 271 | fixed             | Changelog Loads Without Infinite Scroll                                                           | The Changelog Page Stopped Downloading Every Release                    |
| 272 | fixed             | More Pages Fail Gracefully                                                                        | A Failed Load No Longer Reads as an Empty Account                       |
| 273 | fixed             | Disconnecting An Account Confirms Itself                                                          | Actions That Failed in Silence Now Say So                               |
| 274 | fixed             | Documentation Sidebar Highlights Sub-Pages                                                        | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 275 | fixed             | Installed App Opens On The Right Page                                                             | Nothing Scrolls Sideways on a Phone Any More                            |
| 276 | fixed             | Readable Code Blocks In The AI Assistant                                                          | Light Mode Is Readable                                                  |
| 277 | fixed             | Navigation Reflects Where You Are                                                                 | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 278 | changed           | Pricing Page Publishes Its Plans To Search Engines                                                | The Pricing Page Says What You Get for the Money                        |
| 279 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 280 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 281 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 282 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 283 | added             | Admin Panel Opens On A Health Check                                                               | The Admin Panel Opens on a Health Check                                 |
| 284 | security          | Moderators Can No Longer Change A User's Email                                                    | Staff Permissions That Were Not Actually Enforced                       |
| 285 | fixed             | No More Duplicate Broadcast Emails                                                                | Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates          |
| 286 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions                          | Staff Permissions That Were Not Actually Enforced                       |
| 287 | performance       | Documentation Pages Load A Lot Less JavaScript                                                    | A Lot Less JavaScript on First Load                                     |
| 288 | security          | Sign-In Sessions Hashed At Rest                                                                   | Sign-In, Sessions and Two-Factor Hardened                               |
| 289 | security          | API Key Creation Is Rate Limited                                                                  | Endpoints That Had No Rate Limit at All                                 |
| 290 | security          | Stronger Reset And Verification Links                                                             | Sign-In, Sessions and Two-Factor Hardened                               |
| 291 | added             | Encryption Key Rotation Is Now Possible                                                           | Backups and Encryption Keys Stopped Losing Data Quietly                 |
| 292 | security          | Team Invite Accepts Are Rate Limited                                                              | Endpoints That Had No Rate Limit at All                                 |
| 293 | security          | Staff SSO Trusts The Issuer You Configured                                                        | Sign-In, Sessions and Two-Factor Hardened                               |
| 294 | fixed             | In-App Updater Hidden In Docker                                                                   | A Fresh Self-Host Starts on a Blank Postgres                            |
| 295 | performance       | Faster Scan Authorization And Bulk Scans                                                          | Scans Send About Half the Requests They Used To                         |
| 296 | performance       | Lighter Public Host And Export Pages                                                              | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 297 | added             | Rotate A Webhook Signing Secret                                                                   | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 298 | added             | See Why A Webhook Failed                                                                          | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 299 | fixed             | Reset An API Key's Pinned Network                                                                 | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 300 | fixed             | Domains Can Be Shared With A Team                                                                 | Team Scan Sharing Actually Works                                        |
| 301 | fixed             | Truncated Lists Now Say So                                                                        | A Failed Load No Longer Reads as an Empty Account                       |
| 302 | changed           | Honest Plan Descriptions                                                                          | The Pricing Page Says What You Get for the Money                        |
| 303 | changed           | Cleaner Comparison Pages                                                                          | The Landing Page Says Who It Is For                                     |
| 304 | fixed             | Admin Alert Delivery Is Reportable                                                                | Actions That Failed in Silence Now Say So                               |
| 305 | fixed             | Rate Limit Messages Read Properly                                                                 | Actions That Failed in Silence Now Say So                               |
| 306 | security          | Dependency Updates Wait For The Test Suite                                                        | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 307 | fixed             | Scans No Longer Falsely Reported As Interrupted                                                   | Scans Stopped Failing and Hanging at the Edges                          |
| 308 | fixed             | Scan Comparison Opens The Scans You Picked                                                        | Scan History Tells You the Real Numbers                                 |
| 309 | fixed             | Two-Factor Start Over Now Works                                                                   | Sign-In, Sessions and Two-Factor Hardened                               |
| 310 | fixed             | Bulk Scan No Longer Reports False Limit Errors                                                    | Scans Stopped Failing and Hanging at the Edges                          |
| 311 | added             | Shared Scans And Check Pages Get Their Own Link Previews                                          | Shared Reports Unfurl, and the Preview Carries Your Own Branding        |
| 312 | changed           | Consistent Page Titles And A Tidier Checkout                                                      | The Pricing Page Says What You Get for the Money                        |
| 313 | fixed             | The Crash Page Looks Like The Product Again                                                       | A Failed Load No Longer Reads as an Empty Account                       |
| 314 | fixed             | Sign In And Sign Up Paint Something On First Load                                                 | Loading Screens Match the Page That Arrives                             |
| 315 | fixed             | Team Pages Are Linkable And Back Works                                                            | Team Scan Sharing Actually Works                                        |
| 316 | fixed             | Check Counts Now Agree Across Pages                                                               | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 317 | changed           | Homepage Redirect Made Permanent                                                                  | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 318 | fixed             | Scan This Host Now Scans That Host                                                                | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 319 | fixed             | Resend Verification Email Now Works                                                               | Actions That Failed in Silence Now Say So                               |
| 320 | fixed             | Chat Button No Longer Covers Save Changes                                                         | Nothing Scrolls Sideways on a Phone Any More                            |
| 321 | fixed             | Scan Filters Survive The Back Button                                                              | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 322 | added             | Share A Scan With Your Team                                                                       | Team Scan Sharing Actually Works                                        |
| 323 | changed           | Developer Tools Back In The Top Nav                                                               | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 324 | changed           | The Landing Page Links To The Check Reference                                                     | The Landing Page Says Who It Is For                                     |
| 325 | fixed             | Scanning Screen Readable On A Phone                                                               | Nothing Scrolls Sideways on a Phone Any More                            |
| 326 | performance       | Half The Notification Requests, Gone                                                              | A Lot Less JavaScript on First Load                                     |
| 327 | changed           | One Look Across The App                                                                           | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 328 | changed           | Status Colours Follow Your Theme                                                                  | Light Mode Is Readable                                                  |
| 329 | changed           | The Social Tab Looks Like The Rest Of The App                                                     | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 330 | changed           | Clearer API Reference Parameters                                                                  | The API Reference Documents the API That Exists                         |
| 331 | fixed             | Scan Tags No Longer Silently Shortened                                                            | Actions That Failed in Silence Now Say So                               |
| 332 | changed           | One Home For Verified Domains                                                                     | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 333 | changed           | Honest Pricing Page                                                                               | The Pricing Page Says What You Get for the Money                        |
| 334 | fixed             | Database Restores Now Tell You The Truth                                                          | Backups and Encryption Keys Stopped Losing Data Quietly                 |
| 335 | security          | Encrypted Backups Are Verified Before They Are Applied                                            | Backups and Encryption Keys Stopped Losing Data Quietly                 |
| 336 | fixed             | The AI Assistant No Longer Loses Half A Sentence                                                  | The AI Assistant Answers From the Whole Document                        |
| 337 | changed           | Social Card Follows Your Own Branding                                                             | Shared Reports Unfurl, and the Preview Carries Your Own Branding        |
| 338 | performance       | Scans No Longer Stall On Malformed Pages                                                          | A Hostile Page Can No Longer Stall the Scanner                          |
| 339 | security          | Hardened Against Slow-Scan Denial Of Service                                                      | A Hostile Page Can No Longer Stall the Scanner                          |
| 340 | fixed             | More Accurate Tag Matching In Page Checks                                                         | Findings That Reported the Wrong Thing                                  |
| 341 | fixed             | Scheduled And Crawl Scans Reach Your Team                                                         | Team Scan Sharing Actually Works                                        |
| 342 | performance       | Faster Scan Progress And Crawl Saves                                                              | Scans Send About Half the Requests They Used To                         |
| 343 | performance       | Nightly Cleanup No Longer Locks The Database                                                      | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 344 | fixed             | Health Check Now Catches A Half-Built Database                                                    | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 345 | fixed             | Staff Invite Links Now Open A Real Page                                                           | Sixteen Admin Panel Bugs                                                |
| 346 | fixed             | Role Badges Missing Their Colour                                                                  | Light Mode Is Readable                                                  |
| 347 | security          | Leaner Published Container Image                                                                  | CI Builds the Real Image, Boots It, and Waits for the Test Suite        |
| 348 | fixed             | Contact Email Template Said The Wrong Thing                                                       | Your .env Actually Reaches the Container                                |
| 349 | fixed             | Bulk Triage No Longer Loses Your Selection                                                        | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 350 | fixed             | Bulk Actions Only Touch Findings You Can See                                                      | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 351 | changed           | History Header Stopped Repeating Itself                                                           | Scan History Tells You the Real Numbers                                 |
| 352 | fixed             | Consistent Stat Strips Across The App                                                             | Light Mode Is Readable                                                  |
| 353 | fixed             | Checkout No Longer Jumps As It Loads                                                              | Loading Screens Match the Page That Arrives                             |
| 354 | performance       | Removed 27 Duplicate Database Indexes                                                             | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 355 | fixed             | Scans No Longer Fail At The Finish Line Under Load                                                | Scans Stopped Failing and Hanging at the Edges                          |
| 356 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 357 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 358 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 359 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 360 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 361 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 362 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 363 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 364 | changed           | Bulk Scans No Longer Block The Request                                                            | Deep Scans Honour the Options You Picked                                |
| 365 | performance       | Scans No Longer Do Their Network Checks Twice                                                     | Scans Send About Half the Requests They Used To                         |
| 366 | security          | Request Size Limit Now Covers The Whole API                                                       | Endpoints That Had No Rate Limit at All                                 |
| 367 | security          | Scan Volume Is Now Limited Per Target, Not Just Per Account                                       | Endpoints That Had No Rate Limit at All                                 |
| 368 | added             | Badges Now Show An A+ To F Grade                                                                  | Badges Now Show an A+ to F Grade                                        |
| 369 | fixed             | Failed Scans Report Their Real Duration                                                           | Scans Stopped Failing and Hanging at the Edges                          |
| 370 | security          | Signup No Longer Reveals Who Has An Account                                                       | Sign-In, Sessions and Two-Factor Hardened                               |
| 371 | changed           | Four More Rate Limits Moved Into Admin Settings                                                   | Admin Settings That Saved and Then Did Nothing                          |
| 372 | changed           | Port Sweep Speed And Timeouts Are Now Tunable                                                     | Admin Settings That Saved and Then Did Nothing                          |
| 373 | fixed             | Two-Factor Window Setting Now Applies To The Login Cookie                                         | Sign-In, Sessions and Two-Factor Hardened                               |
| 374 | changed           | Pricing Table Now Shows Crawl Pages And Free GitHub Review                                        | The Pricing Page Says What You Get for the Money                        |
| 375 | performance       | The Changelog Page Stopped Downloading Every Release                                              | The Changelog Page Stopped Downloading Every Release                    |
| 376 | performance       | Host Reports Load Their Risk Chart In Parallel                                                    | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 377 | performance       | Background Tabs Stop Polling                                                                      | A Lot Less JavaScript on First Load                                     |
| 378 | added             | The App Tells You When You Are Offline                                                            | A Failed Load No Longer Reads as an Empty Account                       |
| 379 | added             | Command Palette On Ctrl-K                                                                         | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 380 | added             | History Can Be Filtered By Severity And Date, And Sorted                                          | Scan History Tells You the Real Numbers                                 |
| 381 | changed           | Clear All History Moved Away From The Search Box                                                  | Scan History Tells You the Real Numbers                                 |
| 382 | added             | Compare With The Previous Scan, From The Scan Itself                                              | Scan History Tells You the Real Numbers                                 |
| 383 | changed           | Error And Success Messages Look The Same Everywhere                                               | Light Mode Is Readable                                                  |
| 384 | fixed             | Support Ticket Timestamps Read The Same For You And For Us                                        | Support Tickets Read Like a Conversation on Both Sides                  |
| 385 | security          | Webhook Signing Secrets Encrypted At Rest                                                         | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 386 | fixed             | Two Tables Missing From Fresh Installs                                                            | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 387 | fixed             | Accurate Backup-Code Status In The Admin User View                                                | Sixteen Admin Panel Bugs                                                |
| 388 | added             | Docs For Billing, Troubleshooting, And Administration                                             | Documentation Rewritten Where It Was Wrong                              |
| 389 | added             | Screenshots And Two Missing Features In The Extension Docs                                        | Documentation Rewritten Where It Was Wrong                              |
| 390 | changed           | Ten Check Pages No Longer Share Five Titles                                                       | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 391 | fixed             | The Sitemap Now Reports Real Change Dates                                                         | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 392 | added             | Where We Stand On AI Pentesting                                                                   | Documentation Rewritten Where It Was Wrong                              |
| 393 | changed           | Less To Rename When You Fork It                                                                   | Shared Reports Unfurl, and the Preview Carries Your Own Branding        |
| 394 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 395 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 396 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 397 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 398 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 399 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 400 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 401 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 402 | fixed             | Deep Scans With A Login Now Actually Crawl                                                        | Deep Scans Honour the Options You Picked                                |
| 403 | added             | Change A Teammate's Role Without Removing Them                                                    | Team Scan Sharing Actually Works                                        |
| 404 | added             | Reopen A Support Ticket You Resolved                                                              | Support Tickets Read Like a Conversation on Both Sides                  |
| 405 | added             | Import Scan Targets From An API Spec                                                              | Deep Scans Honour the Options You Picked                                |
| 406 | fixed             | Live Browser Sessions Honour The Configured Lifetime                                              | Admin Settings That Saved and Then Did Nothing                          |
| 407 | changed           | We Say What Happens To A Login You Scan With                                                      | Documentation Rewritten Where It Was Wrong                              |
| 408 | security          | Staff Roles No Longer See Data They Were Never Granted                                            | Staff Permissions That Were Not Actually Enforced                       |
| 409 | changed           | Permissions That Did Nothing Are Gone                                                             | Staff Permissions That Were Not Actually Enforced                       |
| 410 | changed           | Schedules And Webhooks API Return An Object, Not A Bare Array                                     | The API Reference Documents the API That Exists                         |
| 411 | added             | Every Request Now Has An Id                                                                       | Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible    |
| 412 | changed           | Dropped Six Unused Database Columns                                                               | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 413 | security          | Server Settings Kept Out Of The Browser                                                           | Staff Permissions That Were Not Actually Enforced                       |
| 414 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 415 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 416 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 417 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 418 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 419 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 420 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 421 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 422 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 423 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 424 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 425 | changed           | Host Details Now Sit Above The Findings                                                           | The Scan Verdict Now Leads the Report                                   |
| 426 | changed           | Finding Triage Controls Moved Up                                                                  | The Scan Verdict Now Leads the Report                                   |
| 427 | changed           | Cleaner Bulk Selection On The Findings List                                                       | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 428 | fixed             | The Admin Panel Loads Into The Shape It Actually Opens On                                         | Loading Screens Match the Page That Arrives                             |
| 429 | changed           | Support Tickets Read Like A Conversation On Both Sides                                            | Support Tickets Read Like a Conversation on Both Sides                  |
| 430 | changed           | Clear All History Is Back At The Top Of The Page                                                  | Scan History Tells You the Real Numbers                                 |
| 431 | fixed             | The Demo Report Now Says Which Site It Scanned                                                    | The Landing Page Says Who It Is For                                     |
| 432 | changed           | Toggles And Checkboxes Animate Instead Of Snapping                                                | Every Dialog Behaves Like a Dialog                                      |
| 433 | changed           | One Navbar Across Every Public Page                                                               | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 434 | fixed             | Docs Top Bar Lines Up With The Rest Of The Site                                                   | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 435 | fixed             | Outlines Back Off Panels, Sharpen On Controls                                                     | Light Mode Is Readable                                                  |
| 436 | fixed             | Toggles, Sliders And Progress Bars Readable In Light Mode                                         | Light Mode Is Readable                                                  |
| 437 | fixed             | Keyboard Focus Visible On Every Control                                                           | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 438 | fixed             | Tabbing No Longer Hides The Thing You Focused                                                     | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 439 | fixed             | Admin Tables Usable Without A Mouse                                                               | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 440 | fixed             | Site Notification Popups Behave Like Real Dialogs                                                 | Every Dialog Behaves Like a Dialog                                      |
| 441 | fixed             | Narrow Screens And Zoomed Text Stop Overflowing                                                   | Nothing Scrolls Sideways on a Phone Any More                            |
| 442 | fixed             | Smaller Controls Meet The Minimum Tap Size                                                        | Nothing Scrolls Sideways on a Phone Any More                            |
| 443 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 444 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 445 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 446 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 447 | fixed             | Sorting And Filtering A Report Is Instant Again                                                   | Sorting and Filtering a Report Is Instant and Survives the Back Button  |
| 448 | fixed             | Save Buttons And Modal Footers Reachable On A Phone                                               | Nothing Scrolls Sideways on a Phone Any More                            |
| 449 | fixed             | Scan Panels No Longer Clip On Narrow Screens                                                      | Nothing Scrolls Sideways on a Phone Any More                            |
| 450 | changed           | Bigger Tap Targets On Mobile                                                                      | Nothing Scrolls Sideways on a Phone Any More                            |
| 451 | added             | Share A Scan With Several Teams                                                                   | Team Scan Sharing Actually Works                                        |
| 452 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 453 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 454 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 455 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 456 | changed           | Clearer Team Sharing Picker                                                                       | Team Scan Sharing Actually Works                                        |
| 457 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 458 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 459 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 460 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 461 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 462 | fixed             | Fresh Databases Get The Whole Schema                                                              | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 463 | fixed             | Weekly Digest Columns Reach Every Install                                                         | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 464 | fixed             | No More Startup Errors On A First Boot                                                            | A Fresh Self-Host Starts on a Blank Postgres                            |
| 465 | fixed             | Consistent Badges On A Cloned Database                                                            | Creating, Cloning and Upgrading a Database Stopped Skipping Tables      |
| 466 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 467 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 468 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 469 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 470 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 471 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 472 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 473 | fixed             | Readable Light Mode In The Browser Extension                                                      | The Browser Extension Can Point at Your Own Instance                    |
| 474 | fixed             | Screen Reader Support In Settings And The Popup                                                   | The Browser Extension Can Point at Your Own Instance                    |
| 475 | fixed             | Bigger Hit Targets And Visible Keyboard Focus                                                     | The Browser Extension Can Point at Your Own Instance                    |
| 476 | fixed             | The On-Page Site Alert Is Harder To Break And Easier To Dismiss                                   | The Browser Extension Can Point at Your Own Instance                    |
| 477 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 478 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 479 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 480 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 481 | changed           | Compare And Badge Are Sign-In Only                                                                | Badges Now Show an A+ to F Grade                                        |
| 482 | added             | Teams Can Have A Picture                                                                          | Team Scan Sharing Actually Works                                        |
| 483 | fixed             | Team List Names Its Owner Again                                                                   | Team Scan Sharing Actually Works                                        |
| 484 | changed           | Admin Panel Regrouped By Job                                                                      | The Admin Panel Opens on a Health Check                                 |
| 485 | added             | Admin Nav Shows Which Section Is Unhealthy                                                        | The Admin Panel Opens on a Health Check                                 |
| 486 | changed           | Destructive Admin Actions Now Look Destructive                                                    | The Admin Panel Opens on a Health Check                                 |
| 487 | changed           | Account Controls Moved Out Of The Panel Footer                                                    | The Admin Panel Opens on a Health Check                                 |
| 488 | changed           | Admin Tables Read At A Glance                                                                     | The Admin Panel Opens on a Health Check                                 |
| 489 | fixed             | Admin Colours Come From The Theme                                                                 | Light Mode Is Readable                                                  |
| 490 | fixed             | Retention Cleanup Now Warns Before It Deletes                                                     | Sixteen Admin Panel Bugs                                                |
| 491 | changed           | Admin Panels Surface The Problem First                                                            | The Admin Panel Opens on a Health Check                                 |
| 492 | fixed             | A Server Error No Longer Reads As "Access Denied" (duplicate of #49)                              | A Failed Load No Longer Reads as an Empty Account                       |
| 493 | performance       | Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans (duplicate of #102)       | Lists Stopped Loading Every Finding to Draw a Badge                     |
| 494 | fixed             | A Missing Stripe Webhook Secret Is Reported As A Misconfiguration (duplicate of #106)             | Billing Bugs That Downgraded the Wrong Account                          |
| 495 | performance       | AI Assistant Context Loads Without Re-Reading Megabytes Per Request (duplicate of #109)           | The AI Assistant Answers From the Whole Document                        |
| 496 | added             | One Page For Every Credit Balance                                                                 | One Page for Every Credit Balance                                       |
| 497 | changed           | Credit Pages Named To Match Each Other                                                            | One Page for Every Credit Balance                                       |
| 498 | changed           | Credit Pages Say What You Already Have                                                            | One Page for Every Credit Balance                                       |
| 499 | fixed             | Clearer Credit Pricing And A Loading State That Matches                                           | One Page for Every Credit Balance                                       |
| 500 | changed           | The Changelog Is Grouped Instead Of One Long List                                                 | The Changelog Page Stopped Downloading Every Release                    |
| 501 | changed           | Documentation Headings You Can Actually Skim                                                      | Documentation You Can Skim                                              |
| 502 | changed           | Code Blocks Stand Out From The Prose Around Them                                                  | Documentation You Can Skim                                              |
| 503 | changed           | Documentation Tables Are Easier To Read Across                                                    | Documentation You Can Skim                                              |
| 504 | changed           | Legal Pages Number Their Clauses Where You Can See Them                                           | Documentation You Can Skim                                              |
| 505 | fixed             | The API Endpoint Index Links To Its Endpoints                                                     | The API Reference Documents the API That Exists                         |
| 506 | fixed             | The On-Page Site Alert Is Harder To Break And Easier To Dismiss (duplicate of #476)               | The Browser Extension Can Point at Your Own Instance                    |
| 507 | fixed             | Severity Colours Follow Your Theme In The Extension                                               | The Browser Extension Can Point at Your Own Instance                    |
| 508 | changed           | The Extension Popup Leads With The Scan                                                           | The Browser Extension Can Point at Your Own Instance                    |
| 509 | changed           | The Verdict Is Easier To Read At A Glance                                                         | The Browser Extension Can Point at Your Own Instance                    |
| 510 | changed           | Extension Settings Show What Each Section Is Set To                                               | The Browser Extension Can Point at Your Own Instance                    |
| 511 | changed           | Panels And Alerts Settle Into Place Instead Of Snapping                                           | The Browser Extension Can Point at Your Own Instance                    |
| 512 | fixed             | The On-Page Alert Card Reads As A Deliberate Object                                               | The Browser Extension Can Point at Your Own Instance                    |
| 513 | fixed             | Loading Screens Match The Page That Arrives                                                       | Loading Screens Match the Page That Arrives                             |
| 514 | changed           | Placeholders Are Built From The Real Thing                                                        | Loading Screens Match the Page That Arrives                             |
| 515 | security          | Private Scans No Longer Start Public                                                              | A Private Scan No Longer Starts Public                                  |
| 516 | fixed             | A Scan That Did Not Finish Is Never Called Clean                                                  | An Unfinished Scan Is Never Reported as Clean                           |
| 517 | fixed             | A Failed Load No Longer Reads As An Empty Account                                                 | A Failed Load No Longer Reads as an Empty Account                       |
| 518 | fixed             | Plan Limits Are Not Guessed While Your Account Loads                                              | Billing Bugs That Downgraded the Wrong Account                          |
| 519 | fixed             | A Finding You Marked Stays Marked                                                                 | A Failed Load No Longer Reads as an Empty Account                       |
| 520 | fixed             | Admin Panels Load Into Their Own Shape                                                            | Loading Screens Match the Page That Arrives                             |
| 521 | fixed             | Skip Link Works While A Page Is Loading                                                           | Keyboard Focus Is Visible and Skip Links Actually Move Focus            |
| 522 | changed           | Pricing Plans Are Now One Comparison Rail                                                         | The Pricing Page Says What You Get for the Money                        |
| 523 | changed           | The Plan Comparison Table Shows Only What Differs                                                 | The Pricing Page Says What You Get for the Money                        |
| 524 | changed           | Severity Colour Where Severity Is The Point                                                       | The Check Reference Got Search, Filters, and Titles That Do Not Collide |
| 525 | changed           | The Link Checker Shows You A Redirect Chain                                                       | The Landing Page Says Who It Is For                                     |
| 526 | fixed             | Faded Text Fixed On Three Public Pages                                                            | Light Mode Is Readable                                                  |
| 527 | fixed             | Consistent Check Count On The Landing Page                                                        | The Landing Page Says Who It Is For                                     |
| 528 | changed           | One Look For Every Dialog                                                                         | Every Dialog Behaves Like a Dialog                                      |
| 529 | fixed             | Dialog Buttons Stay Reachable On Short Screens                                                    | Every Dialog Behaves Like a Dialog                                      |
| 530 | fixed             | Readable Dimming Behind Dialogs In Both Themes                                                    | Every Dialog Behaves Like a Dialog                                      |
| 531 | fixed             | Longer Dialog Titles No Longer Run Under The Close Button                                         | Every Dialog Behaves Like a Dialog                                      |
| 532 | fixed             | Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions (duplicate of #286)      | Staff Permissions That Were Not Actually Enforced                       |
| 533 | changed           | The Scan Verdict Now Leads The Report                                                             | The Scan Verdict Now Leads the Report                                   |
| 534 | fixed             | A Clean Scan Now Looks Like Good News                                                             | An Unfinished Scan Is Never Reported as Clean                           |
| 535 | fixed             | An Unfinished Scan No Longer Reads As A Clean One                                                 | An Unfinished Scan Is Never Reported as Clean                           |
| 536 | changed           | Scan History Reads By Severity And Recency                                                        | Scan History Tells You the Real Numbers                                 |
| 537 | fixed             | History Filters Show When They Are On                                                             | Scan History Tells You the Real Numbers                                 |
| 538 | changed           | A Finding's Severity Is Visible Before You Read It                                                | The Scan Verdict Now Leads the Report                                   |
| 539 | changed           | A Failed Scan Explains Itself More Clearly                                                        | The Scan Verdict Now Leads the Report                                   |
| 540 | fixed             | Share Link Expiry Can Always Be Changed                                                           | A Private Scan No Longer Starts Public                                  |
| 541 | fixed             | Contrast Fixes On The AI Verdict And Remediation Controls                                         | Light Mode Is Readable                                                  |
| 542 | fixed             | Debug Toolbar And Broken Redirect Checks No Longer Stop At The First Match (duplicate of #194)    | Ten Checks Gave Up After the First Match on the Page                    |
| 543 | fixed             | The Cookie Notice No Longer Covers Save Buttons And The Docs Menu (duplicate of #171)             | Nothing Scrolls Sideways on a Phone Any More                            |
| 544 | fixed             | The Documentation Drawer Traps Focus And Keeps Its Close Button (duplicate of #175)               | Every Dialog Behaves Like a Dialog                                      |
| 545 | changed           | The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports (duplicate of #182) | The Landing Page Says Who It Is For                                     |
| 546 | fixed             | The AI Verification Result Panel Has Its Edges Back                                               | Light Mode Is Readable                                                  |
| 547 | changed           | One Team Picker Instead Of One Menu Row Per Team                                                  | Team Scan Sharing Actually Works                                        |
| 548 | added             | Share Links Can Now Expire                                                                        | A Private Scan No Longer Starts Public                                  |
| 549 | fixed             | Badge Is Back In The Navigation Bar                                                               | Badges Now Show an A+ to F Grade                                        |
| 550 | fixed             | "File As GitHub Issue" Only Shows When You Can Use It                                             | One Navbar on Every Public Page, and Links That Go Where They Say       |
| 551 | fixed             | A Support Ticket Says Its State Once                                                              | Support Tickets Read Like a Conversation on Both Sides                  |
| 552 | fixed             | A Ticket That Fails To Open Can Be Retried                                                        | Support Tickets Read Like a Conversation on Both Sides                  |
| 553 | changed           | Tidier Staff Support Inbox                                                                        | Support Tickets Read Like a Conversation on Both Sides                  |
