import {dispatchOfflineFixture} from '../core/run-school-publisher.mjs';
export {createFixture} from './fixture.mjs';
export {SCENARIOS,demoMatrix,validateDemo,mockObservation} from './offline-session.mjs';
export async function simulate(file,options={}){return dispatchOfflineFixture(file,options);}
