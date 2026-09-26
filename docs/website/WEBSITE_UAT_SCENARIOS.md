# Website UAT scenarios

| # | Scenario | Status |
|---|---|---|
| 1 | Visitor reads a specialty page and requests an appointment from real availability | ✅ automated (browser) |
| 2 | Patient Relations receives the request with campaign source (UTM) | ✅ |
| 3 | Employee converts it: patient matched/created, appointment on the requested time | ✅ |
| 4 | Appointment appears in reception and the time disappears from the website | ✅ (DB test + browser) |
| 5 | Funnel follows arrival / completion automatically | ✅ DB test |
| 6 | Offer: approved, capacity-limited, price frozen at booking, hidden when used up or expired | ✅ DB test |
| 7 | Editing live content restarts review; site keeps approved version | ✅ browser + DB test |
| 8 | Unapproved or archived content never reaches the site | ✅ DB test |
| 9 | Anonymous visitor cannot read tables or call staff functions | ✅ DB test |
| 10 | Repeat submissions merge; abuse throttled; invalid phone / missing consent rejected | ✅ DB test |
| 11 | Landing page with real countdown; expires automatically | ✅ |
| 12 | Arabic RTL, English LTR, mobile layout | ✅ screenshots |
| — | Patient logs in, sees appointment, prescriptions, results, invoices | ⏳ portal milestone |
| — | Deposit payment online, package purchase | ⏳ payment gateway milestone |
