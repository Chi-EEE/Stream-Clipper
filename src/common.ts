import { exec } from 'child_process';

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const execPromise = require('util').promisify(exec);

export function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * max) + min;
}