/**
 * Copyright (c) 2017 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { Column } from 'mol-data/db'
import UUID from 'mol-util/uuid'

export interface AtomicConformation {
    id: UUID,

    // ID is part of conformation because mmCIF is a leaky abstraction
    // that assigns different atom ids to corresponding atoms in different models
    // ... go figure.
    atomId: Column<number>,

    occupancy: Column<number>,
    B_iso_or_equiv: Column<number>

    // Coordinates. Generally, not to be accessed directly because the coordinate might be
    // transformed by an operator. Use Unit.getPosition instead.
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>
}