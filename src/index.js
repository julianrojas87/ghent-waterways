import * as ol from 'ol';
import * as proj from 'ol/proj';
import * as layer from 'ol/layer';
import * as source from 'ol/source';
import * as style from 'ol/style';
import * as format from 'ol/format';
import Wkt from 'wicket';
import rdfDeref from "rdf-dereference";
import { Store } from 'n3';
import "setimmediate";

// Vocabulary definitions
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const GEOSPARQL = 'http://www.opengis.net/ont/geosparql#';
const LOCN = 'http://www.w3.org/ns/locn#';

// Utilities
const geoJson = new format.GeoJSON();
const tripleStore = new Store();
var map = null;

// Main function
function init() {
    const popup = document.getElementById('popup');
    const popupContent = document.getElementById('popup-content');
    const closer = document.getElementById('popup-closer');

    // Initialize OpenLayers map with OSM raster images
    const raster = new layer.Tile({
        source: new source.OSM()
    });

    // Create overlay layer for Popup binding
    const overlay = new ol.Overlay({
        element: popup,
        autoPan: true,
        autoPanAnimation: {
            duration: 250,
        },
    });

    // Add a click handler to hide the popup.
    closer.onclick = function () {
        overlay.setPosition(undefined);
        closer.blur();
        return false;
    };

    // Define main map object and display popup on click
    map = new ol.Map({
        layers: [raster],
        overlays: [overlay],
        target: 'map',
        view: new ol.View({
            center: proj.fromLonLat([3.7603483, 51.0803471]),
            zoom: 11
        })
    });

    // Display popup on click
    map.on('click', async evt => {
        const feature = map.forEachFeatureAtPixel(evt.pixel, feature => {
            return feature;
        });

        if (feature) {
            // Get RDF data properties of feature
            const featSubj = getSubjectFromGeometry(feature.getId());
            const dataObj = {
                '@id': featSubj,
                [`${GEOSPARQL}asWKT`]: tripleStore.getQuads(feature.getId(), `${GEOSPARQL}asWKT`)[0].object.value,
                ...getFeatProperties(featSubj)
            };

            // Set popup content
            popupContent.innerHTML = `
                <p><b><code><a href="${dataObj['@id']}" target="_blank">${dataObj['@id']}</a>:</code></b></p>
                <ul>
                    <li><b><a href="${RDF}type" target="_blank">type</a>: </b><code><a href="${dataObj[`${RDF}type`]}" target="_blank">${dataObj[`${RDF}type`].includes('waterdeel') ? 'Waterdeel' : 'Link'}</a></code></li>
                    <li><b><a href="${RDFS}label" target="_blank">label</a>: </b><code>${dataObj[`${RDFS}label`]}</code></li>
                    <li><div class="truncate"><b><a href="${GEOSPARQL}asWKT" target="_blank">WKT geometry</a>: </b><code id=${dataObj['@id']}>${dataObj[`${GEOSPARQL}asWKT`]}</code></div><span class="icon"><img src="http://clipground.com/images/copy-4.png" title="Click to Copy"></li>
                </ul>
            `;

            // Copy function for WKT geometries
            document.getElementsByClassName('icon')[0].onclick = () => {
                const wktText = document.getElementById(dataObj['@id']);
                // Copy text to clipboard
                navigator.clipboard.writeText(wktText.innerText);
                // Flashy animation to show that text was copied
                wktText.classList.add('flashBG');
                setTimeout(() => {
                    wktText.classList.remove('flashBG');
                }, 1000);
            };

            overlay.setPosition(evt.coordinate);
        } else {
            return false;
        }
    });

    // Fetch RDF triples
    rdfDeref.dereference('https://raw.githubusercontent.com/brechtvdv/smartwaterways/master/data/output.nq')
        .then(res => {
            const polygons = [];
            res.quads.on('data', quad => {
                // Store triple in memory for later reuse
                tripleStore.addQuad(quad);

                // Focus on the triples that contain WKT strings, as in triples with geosparql:asWTK predicates
                if (quad.predicate.id === `${GEOSPARQL}asWKT`) {
                    try {
                        // Parse WKT strings to GeoJSON with Wicket library
                        const wicket = new Wkt.Wkt();
                        wicket.read(quad.object.value);
                        // Read the GeoJSON objects and convert them into OpenLayers Features
                        const feat = geoJson.readFeature(wicket.toJson());
                        feat.setId(quad.subject.id);

                        polygons.push({
                            type: wicket.type,
                            feature: feat
                        });
                    } catch (err) {
                        console.error(`Feature ${quad.subject.id} has invalid WKT`);
                    }
                }
            });
            res.quads.on('end', () => {
                plotWKT(polygons);
            });
        });
}

function plotWKT(polygons) {
    const pFeatures = new ol.Collection();
    const lsFeatures = new ol.Collection();

    // Adjust CRS and distiguish between POLYGON and LINSTRING features
    polygons.forEach(p => {
        p.feature.getGeometry().transform('EPSG:4326', 'EPSG:3857');
        if (p.type === 'linestring') lsFeatures.push(p.feature);
        if (p.type === 'polygon') pFeatures.push(p.feature)
    });

    const lsVector = new layer.Vector({
        source: new source.Vector({ features: lsFeatures }),
        style: [
            new style.Style({
                stroke: new style.Stroke({
                    color: '#00C50C',
                    width: 3
                })
            })
        ]
    });

    const pVector = new layer.Vector({
        source: new source.Vector({ features: pFeatures }),
        style: [
            new style.Style({
                stroke: new style.Stroke({
                    color: '#0400FF',
                    width: 3
                }),
                fill: new style.Fill({
                    color: 'rgba(60, 179, 50,0.2)'
                })
            })
        ]
    });

    // Plot them in the map
    map.addLayer(pVector);
    map.addLayer(lsVector);
}

function getSubjectFromGeometry(geom) {
    return tripleStore.getQuads(null, `${LOCN}geometry`, geom)[0].subject.id;
}

function getFeatProperties(subj) {
    const obj = {};
    const quads = tripleStore.getQuads(subj);
    quads.forEach(q => {
        obj[q.predicate.id] = q.object.value;
    });

    return obj;
}

// Run this process when page has been loaded
window.onload = function () {
    init();
};