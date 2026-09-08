import { createContext, useContext, useState, useEffect } from "react";
import { authAPI } from "../services/api";

const AuthContext = createContext();

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const normalizeUser = (user) => {
  if (!user) return user;
  return {
    ...user,
    role: normalizeRole(user.role),
  };
};

const mergeProfileIntoUser = (userData = {}, profileData = {}) => {
  const merged = { ...userData };

  if (userData.role === "employer") {
    const structuredAddress = profileData.businessAddressStructured || profileData.businessAddress;
    if (structuredAddress && typeof structuredAddress === "object") {
      merged.businessAddressStructured = structuredAddress;
    }
  }

  if (profileData && typeof profileData === "object") {
    // profileData is a separate document (JobseekerProfile/EmployerProfile)
    // with its own _id/userId/timestamps — those must never overwrite the
    // User document's own identity fields, or every "is this me?" check
    // downstream (message bubbles, comment ownership, likes, follows)
    // ends up comparing against the wrong id.
    const { businessAddress, _id, id, userId, createdAt, updatedAt, __v, ...restProfile } = profileData;
    Object.assign(merged, restProfile);
  }

  return normalizeUser(merged);
};

export const AuthProvider = ({ children }) => {
  const [user, setUserState] = useState(() => {
    const u = localStorage.getItem("user");
    return u ? normalizeUser(JSON.parse(u)) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(true);

  const persistUser = (nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    if (normalizedUser) {
      localStorage.setItem("user", JSON.stringify(normalizedUser));
    } else {
      localStorage.removeItem("user");
    }
    setUserState(normalizedUser);
  };

  const hydrateUserProfile = async () => {
    const currentToken = localStorage.getItem("token");
    if (!currentToken) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await authAPI.getProfile();
      const mergedUser = mergeProfileIntoUser(data?.user || {}, data?.profile || {});
      persistUser(mergedUser);
    } catch (error) {
      console.warn("Auth hydration failed:", error?.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hydrateUserProfile();
  }, []);

  // localStorage is shared across every tab of this origin. If a different
  // account logs in (or out) in another tab, this tab's in-memory `user`
  // would otherwise keep pointing at the old identity while every new API
  // call it makes actually authenticates as whoever is now in storage —
  // silently attributing this tab's actions to the wrong account. Re-sync
  // on any cross-tab change so that can't happen.
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key !== "token" && event.key !== "user" && event.key !== null) return;

      const nextToken = localStorage.getItem("token");
      const nextUserRaw = localStorage.getItem("user");
      setToken(nextToken);
      setUserState(nextUserRaw ? normalizeUser(JSON.parse(nextUserRaw)) : null);
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const setUser = (value) => {
    const nextValue = typeof value === "function" ? value(user) : value;
    persistUser(nextValue);
  };

  const login = async (tokenValue, userValue) => {
    const normalizedUser = normalizeUser(userValue);
    localStorage.setItem("token", tokenValue);
    localStorage.setItem("tokenExpiry", (Date.now() + 30 * 24 * 60 * 60 * 1000).toString());
    setToken(tokenValue);
    persistUser(normalizedUser);

    try {
      const { data } = await authAPI.getProfile();
      const mergedUser = mergeProfileIntoUser(data?.user || normalizedUser, data?.profile || {});
      persistUser(mergedUser);
    } catch (error) {
      console.warn("Login profile hydration failed:", error?.response?.data?.message || error.message);
    }
  };

  const logout = () => {
    setUserState(null);
    setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("tokenExpiry");
  };

  return (
    <AuthContext.Provider value={{ user, setUser, token, setToken, loading, setLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export { AuthContext };