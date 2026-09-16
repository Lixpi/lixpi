import { createUserInfoPage } from './userInfoPage.ts'
import {
    USER_PORTAL_MODULE_API_VERSION,
    type UserPortalModule,
} from '../types.ts'

export const USER_INFO_ROUTE_PATH = '/'

export const accountPortalModule: UserPortalModule = {
    id: 'account',
    apiVersion: USER_PORTAL_MODULE_API_VERSION,
    navigationGroups: [{
        label: 'Account',
        items: [{
            label: 'User information',
            path: USER_INFO_ROUTE_PATH,
        }],
    }],
    routes: [{
        path: USER_INFO_ROUTE_PATH,
        createView: ({ userStore }) => createUserInfoPage({ store: userStore }),
    }],
}
