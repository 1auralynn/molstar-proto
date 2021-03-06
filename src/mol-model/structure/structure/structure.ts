/**
 * Copyright (c) 2017-2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { IntMap, SortedArray, Iterator, Segmentation } from 'mol-data/int'
import { UniqueArray } from 'mol-data/generic'
import { SymmetryOperator } from 'mol-math/geometry/symmetry-operator'
import { Model, ElementIndex } from '../model'
import { sort, arraySwap, hash1, sortArray } from 'mol-data/util';
import StructureElement from './element'
import Unit from './unit'
import { StructureLookup3D } from './util/lookup3d';
import { CoarseElements } from '../model/properties/coarse';
import { StructureSubsetBuilder } from './util/subset-builder';
import { InterUnitBonds, computeInterUnitBonds } from './unit/links';
import { CrossLinkRestraints, extractCrossLinkRestraints } from './unit/pair-restraints';
import StructureSymmetry from './symmetry';
import StructureProperties from './properties';

class Structure {
    readonly unitMap: IntMap<Unit>;
    readonly units: ReadonlyArray<Unit>;
    /** Count of all elements in the structure, i.e. the sum of the elements in the units */
    readonly elementCount: number;

    private _hashCode = 0;

    subsetBuilder(isSorted: boolean) {
        return new StructureSubsetBuilder(this, isSorted);
    }

    get hashCode() {
        if (this._hashCode !== 0) return this._hashCode;
        return this.computeHash();
    }

    private computeHash() {
        let hash = 23;
        for (let i = 0, _i = this.units.length; i < _i; i++) {
            const u = this.units[i];
            hash = (31 * hash + u.id) | 0;
            hash = (31 * hash + SortedArray.hashCode(u.elements)) | 0;
        }
        hash = (31 * hash + this.elementCount) | 0;
        hash = hash1(hash);
        this._hashCode = hash;
        return hash;
    }

    elementLocations(): Iterator<StructureElement> {
        return new Structure.ElementLocationIterator(this);
    }

    get boundary() {
        return this.lookup3d.boundary;
    }

    private _lookup3d?: StructureLookup3D = void 0;
    get lookup3d() {
        if (this._lookup3d) return this._lookup3d;
        this._lookup3d = new StructureLookup3D(this);
        return this._lookup3d;
    }

    private _links?: InterUnitBonds = void 0;
    get links() {
        if (this._links) return this._links;
        this._links = computeInterUnitBonds(this);
        return this._links;
    }

    private _crossLinkRestraints?: CrossLinkRestraints = void 0;
    get crossLinkRestraints() {
        if (this._crossLinkRestraints) return this._crossLinkRestraints;
        this._crossLinkRestraints = extractCrossLinkRestraints(this);
        return this._crossLinkRestraints;
    }

    private _unitSymmetryGroups?: ReadonlyArray<Unit.SymmetryGroup> = void 0;
    get unitSymmetryGroups(): ReadonlyArray<Unit.SymmetryGroup> {
        if (this._unitSymmetryGroups) return this._unitSymmetryGroups;
        this._unitSymmetryGroups = StructureSymmetry.computeTransformGroups(this);
        return this._unitSymmetryGroups;
    }

    constructor(units: ArrayLike<Unit>) {
        const map = IntMap.Mutable<Unit>();
        let elementCount = 0;
        let isSorted = true;
        let lastId = units.length > 0 ? units[0].id : 0;
        for (let i = 0, _i = units.length; i < _i; i++) {
            const u = units[i];
            map.set(u.id, u);
            elementCount += u.elements.length;
            if (u.id < lastId) isSorted = false;
            lastId = u.id;
        }
        if (!isSorted) sort(units, 0, units.length, cmpUnits, arraySwap)
        this.unitMap = map;
        this.units = units as ReadonlyArray<Unit>;
        this.elementCount = elementCount;
    }
}

function cmpUnits(units: ArrayLike<Unit>, i: number, j: number) { return units[i].id - units[j].id; }

namespace Structure {
    export const Empty = new Structure([]);

    export function create(units: ReadonlyArray<Unit>): Structure { return new Structure(units); }

    /**
     * Construct a Structure from a model.
     *
     * Generally, a single unit corresponds to a single chain, with the exception
     * of consecutive "single atom chains".
     */
    export function ofModel(model: Model): Structure {
        const chains = model.atomicHierarchy.chainAtomSegments;
        const builder = new StructureBuilder();

        for (let c = 0; c < chains.count; c++) {
            const start = chains.offsets[c];

            // merge all consecutive "single atom chains"
            while (c + 1 < chains.count
                && chains.offsets[c + 1] - chains.offsets[c] === 1
                && chains.offsets[c + 2] - chains.offsets[c + 1] === 1) {
                c++;
            }

            const elements = SortedArray.ofBounds(start as ElementIndex, chains.offsets[c + 1] as ElementIndex);
            builder.addUnit(Unit.Kind.Atomic, model, SymmetryOperator.Default, elements);
        }

        const cs = model.coarseHierarchy;
        if (cs.isDefined) {
            if (cs.spheres.count > 0) {
                addCoarseUnits(builder, model, model.coarseHierarchy.spheres, Unit.Kind.Spheres);
            }
            if (cs.gaussians.count > 0) {
                addCoarseUnits(builder, model, model.coarseHierarchy.gaussians, Unit.Kind.Gaussians);
            }
        }

        return builder.getStructure();
    }

    function addCoarseUnits(builder: StructureBuilder, model: Model, elements: CoarseElements, kind: Unit.Kind) {
        const { chainElementSegments } = elements;
        for (let cI = 0; cI < chainElementSegments.count; cI++) {
            const elements = SortedArray.ofBounds<ElementIndex>(chainElementSegments.offsets[cI], chainElementSegments.offsets[cI + 1]);
            builder.addUnit(kind, model, SymmetryOperator.Default, elements);
        }
    }

    export class StructureBuilder {
        private units: Unit[] = [];

        addUnit(kind: Unit.Kind, model: Model, operator: SymmetryOperator, elements: StructureElement.Set): Unit {
            const unit = Unit.create(this.units.length, kind, model, operator, elements);
            this.units.push(unit);
            return unit;
        }

        addWithOperator(unit: Unit, operator: SymmetryOperator): Unit {
            const newUnit = unit.applyOperator(this.units.length, operator);
            this.units.push(newUnit);
            return newUnit;
        }

        getStructure(): Structure {
            return create(this.units);
        }

        get isEmpty() {
            return this.units.length === 0;
        }
    }

    export function Builder() { return new StructureBuilder(); }

    export function getModels(s: Structure) {
        const { units } = s;
        const arr = UniqueArray.create<Model['id'], Model>();
        for (const u of units) {
            UniqueArray.add(arr, u.model.id, u.model);
        }
        return arr.array;
    }

    export function hashCode(s: Structure) {
        return s.hashCode;
    }

    export function areEqual(a: Structure, b: Structure) {
        if (a.elementCount !== b.elementCount) return false;
        const len = a.units.length;
        if (len !== b.units.length) return false;

        for (let i = 0; i < len; i++) {
            if (a.units[i].id !== b.units[i].id) return false;
        }

        for (let i = 0; i < len; i++) {
            if (!SortedArray.areEqual(a.units[i].elements, b.units[i].elements)) return false;
        }

        return true;
    }

    export class ElementLocationIterator implements Iterator<StructureElement> {
        private current = StructureElement.create();
        private unitIndex = 0;
        private elements: StructureElement.Set;
        private maxIdx = 0;
        private idx = -1;

        hasNext: boolean;
        move(): StructureElement {
            this.advance();
            this.current.element = this.elements[this.idx];
            return this.current;
        }

        private advance() {
            if (this.idx < this.maxIdx) {
                this.idx++;

                if (this.idx === this.maxIdx) this.hasNext = this.unitIndex + 1 < this.structure.units.length;
                return;
            }

            this.idx = 0;
            this.unitIndex++;
            if (this.unitIndex >= this.structure.units.length) {
                this.hasNext = false;
                return;
            }

            this.current.unit = this.structure.units[this.unitIndex];
            this.elements = this.current.unit.elements;
            this.maxIdx = this.elements.length - 1;
        }

        constructor(private structure: Structure) {
            this.hasNext = structure.elementCount > 0;
            if (this.hasNext) {
                this.elements = structure.units[0].elements;
                this.maxIdx = this.elements.length - 1;
                this.current.unit = structure.units[0];
            }
        }
    }

    export function getEntityKeys(structure: Structure) {
        const { units } = structure;
        const l = StructureElement.create();
        const keys = UniqueArray.create<number, number>();

        for (const unit of units) {
            const prop = unit.kind === Unit.Kind.Atomic ? StructureProperties.entity.key : StructureProperties.coarse.entityKey;

            l.unit = unit;
            const elements = unit.elements;

            const chainsIt = Segmentation.transientSegments(unit.model.atomicHierarchy.chainAtomSegments, elements);
            while (chainsIt.hasNext) {
                const chainSegment = chainsIt.move();
                l.element = elements[chainSegment.start];
                const key = prop(l);
                UniqueArray.add(keys, key, key);
            }
        }

        sortArray(keys.array);
        return keys.array;
    }
}

export default Structure