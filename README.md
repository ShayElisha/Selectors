# שיבוצון

אפליקציית ווב לניהול ושיבוץ בודקים בעמדות שער יציאה — React + MongoDB Atlas + Vercel.

## פיתוח מקומי

1. העתיקו `.env.example` ל-`.env` והדביקו את `MONGODB_URI`.
2. הריצו:

```bash
npm install
npm run dev
```

- Frontend: `http://127.0.0.1:5173`
- API מקומי: `http://127.0.0.1:3001` (דרך Vite proxy ל-`/api`)

## פריסה ל-Vercel

1. חברו את הריפו ל-[Vercel](https://vercel.com).
2. הוסיפו Environment Variable:
   - `MONGODB_URI` = מחרוזת החיבור ל-Atlas (כולל שם DB, למשל `.../shibutzon?retryWrites=true&w=majority`)
3. ב-Atlas → Network Access אפשרו גישה מ-`0.0.0.0/0` (נדרש ל-Serverless).
4. Deploy.

ה-API רץ כ-Serverless Functions תחת `/api/*`, והפרונט נבנה מ-Vite ל-`dist`.

## אבטחה

אל תעלו את `.env` ל-Git. אם סיסמה נחשפה — החליפו אותה ב-Atlas.
