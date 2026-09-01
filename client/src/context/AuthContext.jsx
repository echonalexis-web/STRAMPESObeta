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
    const { businessAddress, ...restProfile } = profileData;
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