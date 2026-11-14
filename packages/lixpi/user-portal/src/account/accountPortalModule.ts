import { createAccountPreferencesPage } from './accountPreferencesPage.ts'
import { createUserInfoPage } from './userInfoPage.ts'
import {
    USER_PORTAL_MODULE_API_VERSION,
    type UserPortalModule,
} from '../types.ts'

export const USER_INFO_ROUTE_PATH = '/'
const ACCOUNT_PREFERENCES_ROUTE_PATH = '/preferences'

export const accountPortalModule: UserPortalModule = {
    id: 'account',
    apiVersion: USER_PORTAL_MODULE_API_VERSION,
    navigationGroups: [{
        label: 'Account',
        items: [
            {
                label: 'Profile',
                path: USER_INFO_ROUTE_PATH,
            },
            {
                label: 'Preferences',
                path: ACCOUNT_PREFERENCES_ROUTE_PATH,
            },
        ],
    }],
    routes: [{
        path: USER_INFO_ROUTE_PATH,
        createView: ({
            userStore,
            loadingLayer,
        }) => createUserInfoPage({
            store: userStore,
            loadingLayer,
        }),
    }, {
        path: ACCOUNT_PREFERENCES_ROUTE_PATH,
        createView: createAccountPreferencesPage,
    }],
}
