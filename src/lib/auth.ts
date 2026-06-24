import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID as string,
      clientSecret: process.env.GITHUB_SECRET as string,
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubUsername: profile.login, // Зберігаємо логін GitHub для мапінгу комітів
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        // Додаємо id користувача та githubUsername в об'єкт сесії клієнта
        // @ts-ignore
        session.user.id = user.id;
        // @ts-ignore
        session.user.githubUsername = user.githubUsername;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};