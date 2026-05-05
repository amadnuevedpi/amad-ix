# AMAD IX — Quick Reference Card

## URLs (fill in after setup)
| | URL |
|---|---|
| **App (live)** | `https://_____________________.github.io/amad-ix/` |
| **GitHub repo** | `https://github.com/___________________/amad-ix` |
| **Supabase dashboard** | `https://supabase.com/dashboard/project/____________` |

---

## Login Credentials (CHANGE THESE!)
| Role | Market/Station | Default Password |
|------|---------------|-----------------|
| Admin | ⚙️ System Administrator | `admin2025` |
| Verifier | 🔍 Regional Verifier | `verify` |
| All Encoders | (their market) | `1234` |

---

## Key Features by Role

### Encoder
- ✏️ Encode prices for your market
- 💾 Save & Lock the day when done
- ⚠️ See your own flagged entries → correct them directly in the flag panel
- 📋 Request edit approval if a locked day needs changes

### Verifier
- 🚩 See all flagged entries across all markets
- 💬 Add remarks explaining why an entry is flagged
- ✅ Mark entries as Verified (green) or Resolved
- See encoder corrections with old vs new value

### Admin
- All verifier permissions
- 📋 Approve or reject edit requests by date
- 🔓 Unlock a saved day manually
- 👤 Manage user accounts

---

## Flag Colors
| Color | Meaning | Who acts |
|-------|---------|---------|
| 🔴 Red | >25% outlier — likely error | Encoder corrects |
| 🟡 Amber | 10–25% deviation — needs review | Verifier reviews |
| 🔵 Blue | Manually flagged by verifier | Encoder corrects |

---

## Lock System (Daily)
1. Encoder encodes prices for Monday
2. Clicks 💾 **Save** → Monday is locked
3. To edit a locked cell → click **📋 Request Edit for DD/MM/YYYY**
4. Admin approves → day unlocks for that market
5. **Exception:** Flagged cells can always be corrected without approval

---

## Saving to Cloud
Data saves to Supabase (cloud) when encoder clicks **💾 Save**.  
Real-time: changes appear for verifier/admin instantly — no refresh needed.
