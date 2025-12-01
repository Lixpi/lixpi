import Auth0Service from './auth0-service.ts'
import Auth0MockService from './auth0-mock-service.ts'

// Conditional export: Use mock or real Auth0 service based on VITE_MOCK_AUTH flag
const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true'

const AuthService = MOCK_AUTH ? Auth0MockService : Auth0Service

export default AuthService
